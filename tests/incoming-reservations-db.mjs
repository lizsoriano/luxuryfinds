import fs from 'node:fs'; import {PGlite} from '../.tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js';
export async function setup(){
 const db=new PGlite(); globalThis.testDb=db; await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,allowed_mime_types text[]); CREATE TABLE storage.objects(name text,bucket_id text); CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS 'SELECT string_to_array(name,''/'')'; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
 const schema=fs.readFileSync('database/schema.sql','utf8').replace(/CREATE EXTENSION IF NOT EXISTS (citext|pgcrypto);/g,'').replace(/\bcitext\b/g,'text');await db.exec(schema);
 for(const n of ['001','002','008','009','010','011','012','013','014','015','016']){const file=fs.readdirSync('database/migrations').find(file=>file.startsWith(n+'_'));console.log('loading',file);await db.exec(fs.readFileSync('database/migrations/'+file,'utf8').replace(/\bcitext\b/g,'text'));}
 return db;
}

