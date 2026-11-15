const bcrypt=require('bcryptjs');const fs=require('fs');
module.exports=async(db)=>{
const ex=await db.query("SELECT to_regclass('public.users') t");if(ex.rows[0].t)return;
await db.query(fs.readFileSync('schema.sql','utf8'));
const C=[['zliten','Zliten Hospital','Zliten','#0b7285'],['tripoli','Tripoli Medical Center','Tripoli','#c2255c'],['misurata','Misurata Hospital','Misurata','#2b8a3e'],['zawia','Zawia Hospital','Zawia','#e8590c']];
for(const c of C)await db.query('INSERT INTO medical_centers(slug,name,city,theme_color) VALUES($1,$2,$3,$4)',c);
const P={doctor:['record.read','diagnosis.write','prescription.write','lab.request','note.write'],nurse:['record.read','vitals.write','note.write'],
receptionist:['patient.register','patient.search','visit.manage'],admin:['user.manage','audit.read']};
for(const r in P){const{rows:[ro]}=await db.query('INSERT INTO roles(name) VALUES($1) RETURNING id',[r]);
 for(const p of P[r]){const{rows:[pe]}=await db.query('INSERT INTO permissions(code) VALUES($1) ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code RETURNING id',[p]);
 await db.query('INSERT INTO role_permissions VALUES($1,$2)',[ro.id,pe.id]);}}
const h=await bcrypt.hash('Pass1234',10);
for(const [i,c] of C.entries())for(const r of Object.keys(P))
 await db.query('INSERT INTO users(full_name,username,password_hash,role_id,center_id) VALUES($1,$2,$3,(SELECT id FROM roles WHERE name=$4),$5)',[`${r} ${c[0]}`,`${r}_${c[0]}`,h,r,i+1]);
console.log('Database created and demo users added.')};
