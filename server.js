const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const SECRET=process.env.JWT_SECRET||'change-me';const app=express();app.use(express.json());app.use(express.static('public'));
const log=(u,patient,permission,decision,reason,emergency,req)=>db.query('INSERT INTO audit_logs(user_id,center_id,patient_id,action,permission,decision,reason,emergency,ip) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
 [u.id,u.center,patient||null,req.method+' '+req.path,permission,decision,reason||null,!!emergency,req.ip]);

// ---- Authentication (JWT) ----
app.post('/api/auth/login',async(req,res)=>{const{username,password}=req.body;
 const{rows:[u]}=await db.query('SELECT u.*,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE username=$1 AND active',[username]);
 if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'Invalid credentials'});
 res.json({token:jwt.sign({id:u.id,role:u.role,center:u.center_id,name:u.full_name},SECRET,{expiresIn:'8h'}),role:u.role,name:u.full_name,center:u.center_id});});
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').slice(7),SECRET);next()}catch{res.status(401).json({error:'Login required'})}};

// ---- RBAC: does the role hold the permission? ----
const can=async(u,perm)=>(await db.query('SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name=$1 AND p.code=$2',[u.role,perm])).rowCount>0;
// ---- ABAC: treatment relationship (open/scheduled visit at the user's center, assigned to them or any clinician there) or justified emergency ----
async function guard(req,res,perm,patientId,{emergency}={}){const u=req.user;
 if(!await can(u,perm)){await log(u,patientId,perm,'DENY','role lacks permission',false,req);res.status(403).json({error:'Role not permitted'});return false}
 if(!patientId)return true;
 const{rowCount}=await db.query("SELECT 1 FROM patient_visits WHERE patient_id=$1 AND center_id=$2 AND status IN('open','scheduled') AND (doctor_id=$3 OR doctor_id IS NULL OR $4<>'doctor')",[patientId,u.center,u.id,u.role]);
 if(rowCount){await log(u,patientId,perm,'ALLOW','treatment relationship',false,req);return true}
 const why=(emergency||'').trim();
 if(why.length>=10){await log(u,patientId,perm,'ALLOW',why,true,req);return true}   // break-glass, flagged for review
 await log(u,patientId,perm,'DENY','no treatment relationship',false,req);
 res.status(403).json({error:'No treatment relationship. Provide emergency_reason (min 10 chars) for break-glass access.'});return false}

app.get('/api/centers',async(q,r)=>r.json((await db.query('SELECT * FROM medical_centers ORDER BY id')).rows));
app.get('/api/centers/:slug',async(q,r)=>r.json((await db.query('SELECT * FROM medical_centers WHERE slug=$1',[q.params.slug])).rows[0]||{}));

// Receptionist: register once globally (national_id unique) / search / open visit at THEIR center
app.post('/api/patients',auth,async(req,res)=>{if(!await guard(req,res,'patient.register'))return;
 const b=req.body;try{const{rows:[p]}=await db.query('INSERT INTO patients(national_id,full_name,birth_date,gender,phone,registered_at_center) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.national_id,b.full_name,b.birth_date,b.gender,b.phone,req.user.center]);res.json(p)}
 catch(e){res.status(409).json({error:'National ID already registered in the central system: search for the patient instead'})}});
app.get('/api/patients/search',auth,async(req,res)=>{if(!await guard(req,res,'patient.search'))return;
 res.json((await db.query('SELECT id,patient_code,national_id,full_name,birth_date,gender FROM patients WHERE national_id=$1 OR patient_code=$1',[req.query.q])).rows)});
app.post('/api/visits',auth,async(req,res)=>{if(!await guard(req,res,'visit.manage'))return;
 const b=req.body;res.json((await db.query('INSERT INTO patient_visits(patient_id,center_id,doctor_id,reason,status,scheduled_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.patient_id,req.user.center,b.doctor_id||null,b.reason,b.scheduled_at?'scheduled':'open',b.scheduled_at||null])).rows[0])});
app.get('/api/doctors',auth,async(q,r)=>r.json((await db.query("SELECT u.id,u.full_name FROM users u JOIN roles ro ON ro.id=u.role_id WHERE ro.name='doctor' AND u.center_id=$1",[q.user.center])).rows));

// Clinical: full cross-center history (same central rows for every hospital)
app.get('/api/patients/:id/record',auth,async(req,res)=>{const id=req.params.id;
 if(!await guard(req,res,'record.read',id,{emergency:req.query.emergency_reason}))return;
 const q=(t,x='')=>db.query(`SELECT t.*,c.name center_name FROM ${t} t LEFT JOIN medical_centers c ON c.id=${x||'(SELECT center_id FROM patient_visits v WHERE v.id=t.visit_id)'} WHERE t.patient_id=$1 ORDER BY t.created_at DESC`,[id]);
 const [p,v,d,rx,lr,im,n,vs]=await Promise.all([db.query('SELECT * FROM patients WHERE id=$1',[id]),
  db.query('SELECT v.*,c.name center_name FROM patient_visits v JOIN medical_centers c ON c.id=v.center_id WHERE patient_id=$1 ORDER BY created_at DESC',[id]),
  q('diagnoses'),q('prescriptions'),
  db.query('SELECT r.*,q.test_name,c.name center_name FROM lab_results r JOIN lab_requests q ON q.id=r.request_id LEFT JOIN medical_centers c ON c.id=r.performed_at_center WHERE r.patient_id=$1 ORDER BY r.created_at DESC',[id]),
  q('imaging_records','t.performed_at_center'),q('medical_notes'),q('vital_signs')]);
 res.json({patient:p.rows[0],visits:v.rows,diagnoses:d.rows,prescriptions:rx.rows,lab_results:lr.rows,imaging:im.rows,notes:n.rows,vitals:vs.rows})});

// Writes: always attached to an open visit at the writer's own center
const visitOk=async(req,res,pid,vid)=>{const{rowCount}=await db.query("SELECT 1 FROM patient_visits WHERE id=$1 AND patient_id=$2 AND center_id=$3 AND status='open'",[vid,pid,req.user.center]);if(!rowCount)res.status(400).json({error:'Needs an open visit at your center'});return rowCount>0};
const W={diagnoses:['diagnosis.write',['icd_code','description'],'doctor_id'],prescriptions:['prescription.write',['drug','dose','duration'],'doctor_id'],
 lab_requests:['lab.request',['test_name'],'doctor_id'],medical_notes:['note.write',['kind','body'],'author_id'],vital_signs:['vitals.write',['bp','pulse','temp','spo2'],'nurse_id']};
for(const t in W)app.post(`/api/patients/:id/${t}`,auth,async(req,res)=>{const[perm,cols,who]=W[t],pid=req.params.id;
 if(!await guard(req,res,perm,pid))return;if(!await visitOk(req,res,pid,req.body.visit_id))return;
 const f=['visit_id','patient_id',who,...cols],v=[req.body.visit_id,pid,req.user.id,...cols.map(c=>req.body[c]??null)];
 res.json((await db.query(`INSERT INTO ${t}(${f}) VALUES(${f.map((_,i)=>'$'+(i+1))}) RETURNING *`,v)).rows[0])});
// Imaging: upload the file to free storage (Supabase/Cloudinary) from the browser, then store its URL here
app.post('/api/patients/:id/imaging',auth,async(req,res)=>{if(!await guard(req,res,'lab.request',req.params.id))return;
 res.json((await db.query('INSERT INTO imaging_records(visit_id,patient_id,modality,file_url,report,performed_at_center) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.body.visit_id,req.params.id,req.body.modality,req.body.file_url,req.body.report,req.user.center])).rows[0])});

// Admin: audit review (no clinical access at all)
app.get('/api/audit',auth,async(req,res)=>{if(!await guard(req,res,'audit.read'))return;
 res.json((await db.query('SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY at DESC LIMIT 200')).rows)});

// One home page per hospital: /h/zliten, /h/tripoli, /h/misurata, /h/zawia
app.get('/h/:slug',(q,r)=>r.sendFile(__dirname+'/public/index.html'));
require('./seed')(db).then(()=>app.listen(process.env.PORT||3000,()=>console.log('MedLink up'))).catch(e=>{console.error(e);process.exit(1)});
