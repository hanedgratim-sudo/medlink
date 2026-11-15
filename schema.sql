-- MedLink central schema (PostgreSQL). One patient identity, many visits across centers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE medical_centers(id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL, theme_color TEXT DEFAULT '#0a7');
CREATE TABLE roles(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE permissions(id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL);
CREATE TABLE role_permissions(role_id INT REFERENCES roles, permission_id INT REFERENCES permissions, PRIMARY KEY(role_id,permission_id));
CREATE TABLE users(id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role_id INT REFERENCES roles NOT NULL, center_id INT REFERENCES medical_centers NOT NULL, active BOOL DEFAULT true);
-- Single system-wide identity: national_id is unique, patient_code is the system-wide ID.
CREATE TABLE patients(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_code TEXT UNIQUE NOT NULL DEFAULT ('P'||floor(random()*1e10)::bigint),
  national_id TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, birth_date DATE, gender TEXT, phone TEXT,
  registered_at_center INT REFERENCES medical_centers, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE patient_visits(id SERIAL PRIMARY KEY, patient_id UUID REFERENCES patients NOT NULL, center_id INT REFERENCES medical_centers NOT NULL,
  doctor_id INT REFERENCES users, reason TEXT, status TEXT DEFAULT 'open' CHECK(status IN('scheduled','open','closed')),
  scheduled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());   -- doubles as appointment + treatment relationship
CREATE TABLE diagnoses(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits NOT NULL, patient_id UUID REFERENCES patients NOT NULL, doctor_id INT REFERENCES users, icd_code TEXT, description TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE prescriptions(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits NOT NULL, patient_id UUID REFERENCES patients NOT NULL, doctor_id INT REFERENCES users, drug TEXT NOT NULL, dose TEXT, duration TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE lab_requests(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits NOT NULL, patient_id UUID REFERENCES patients NOT NULL, doctor_id INT REFERENCES users, test_name TEXT NOT NULL, status TEXT DEFAULT 'requested', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE lab_results(id SERIAL PRIMARY KEY, request_id INT REFERENCES lab_requests NOT NULL, patient_id UUID REFERENCES patients NOT NULL, result TEXT NOT NULL, unit TEXT, reference_range TEXT, performed_at_center INT REFERENCES medical_centers, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE imaging_records(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits, patient_id UUID REFERENCES patients NOT NULL, modality TEXT, file_url TEXT NOT NULL, -- file lives in free object storage (Supabase/Cloudinary)
  report TEXT, performed_at_center INT REFERENCES medical_centers, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE medical_notes(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits NOT NULL, patient_id UUID REFERENCES patients NOT NULL, author_id INT REFERENCES users, kind TEXT DEFAULT 'clinical', body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE vital_signs(id SERIAL PRIMARY KEY, visit_id INT REFERENCES patient_visits NOT NULL, patient_id UUID REFERENCES patients NOT NULL, nurse_id INT REFERENCES users, bp TEXT, pulse INT, temp NUMERIC(4,1), spo2 INT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE audit_logs(id BIGSERIAL PRIMARY KEY, user_id INT, center_id INT, patient_id UUID, action TEXT, permission TEXT, decision TEXT, reason TEXT, emergency BOOL DEFAULT false, ip TEXT, at TIMESTAMPTZ DEFAULT now());
CREATE INDEX ON patient_visits(patient_id); CREATE INDEX ON audit_logs(patient_id); CREATE INDEX ON patients(national_id);
