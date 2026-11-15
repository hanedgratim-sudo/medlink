# MedLink – central healthcare system (4 hospitals, 1 database)
See the step-by-step guide in the chat. The server creates tables and demo users automatically on first start.
1. Create free Postgres (Neon or Supabase) -> copy connection string.
3. Push to GitHub -> Render "New Web Service": build `npm install`, start `npm start`, env: DATABASE_URL, JWT_SECRET.
4. Open /h/zliten, /h/tripoli, /h/misurata, /h/zawia. Users: doctor_zliten, nurse_tripoli, receptionist_misurata, admin_zawia ...
Demo: reception in Zliten registers a patient + opens visit; doctor_zliten adds data; reception in Misurata opens a visit; doctor_misurata reads the Zliten history.
