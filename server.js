const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// MODO DEMO — debe estar antes de todo
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEMO_MAX_ALUMNOS = 5;
const DB_SCHEMA = DEMO_MODE ? 'demo' : 'public';
if (DEMO_MODE) console.log('🎯 MODO DEMO ACTIVO — schema: demo, máximo 5 alumnos');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    if (DEMO_MODE) await client.query('SET search_path TO demo');
    const res = await client.query(sql, params);
    return res.rows;
  } finally { client.release(); }
}
async function q1(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }

const MESES_TODO_EL_MES = [1, 5];
const MESES_NOMBRE_ALL = ['Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_IDX = [2,3,4,5,6,7,8,9,10,11];

function getPrecio(alumno, numCuota, dia) {
  const esBonif = MESES_TODO_EL_MES.includes(numCuota) || dia <= 10;
  return esBonif ? parseFloat(alumno.precio_bonificado) : parseFloat(alumno.precio_normal);
}

async function cuota10Gratis(alumnoId, alumno, cuotasPrec) {
  const cuotas19 = cuotasPrec
    ? cuotasPrec.filter(c=>c.numero_cuota<=9)
    : await q('SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota<=9', [alumnoId]);
  if (cuotas19.length < 9) return false;
  return cuotas19.every(c => c.estado === 'pagada' && (MESES_TODO_EL_MES.includes(c.numero_cuota) || parseFloat(c.monto_pagado) <= parseFloat(alumno.precio_bonificado)));
}

function normalizarCuit(valor) {
  if (!valor && valor !== 0) return null;
  const s = String(valor).replace(/[^0-9]/g, '');
  // Aceptar CUIT (11 dígitos) o DNI (7-8 dígitos)
  if (s.length === 11 || s.length === 8 || s.length === 7) return s;
  const match = s.match(/\d{11}/) || s.match(/\d{8}/) || s.match(/\d{7}/);
  return match ? match[0] : null;
}

function parsearMonto(valor) {
  if (!valor && valor !== 0) return 0;
  let s = String(valor).trim().replace(/\$\s*/g, '').trim();
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s)) { s = s.replace(/\./g, '').replace(',', '.'); }
  else if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(s)) { s = s.replace(/,/g, ''); }
  else { s = s.replace(/[^0-9,\.]/g, ''); const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.'); if(lc>ld){s=s.replace(/\./g,'').replace(',','.');}else{s=s.replace(/,/g,'');} }
  return parseFloat(s) || 0;
}

async function inicializarDB() {
  // Crear schema demo si corresponde
  if (DEMO_MODE) {
    const client = await pool.connect();
    try { await client.query('CREATE SCHEMA IF NOT EXISTS demo'); } finally { client.release(); }
  }
  await q(`
    CREATE TABLE IF NOT EXISTS cursos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, activo BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS alumnos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, curso TEXT NOT NULL, cuits TEXT DEFAULT '', precio_normal NUMERIC DEFAULT 0, precio_bonificado NUMERIC DEFAULT 0, activo BOOLEAN DEFAULT TRUE, telefono TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS cuotas (id SERIAL PRIMARY KEY, alumno_id INTEGER NOT NULL, numero_cuota INTEGER NOT NULL, estado TEXT DEFAULT 'pendiente', fecha_pago TEXT DEFAULT '', monto_pagado NUMERIC DEFAULT 0, compensada BOOLEAN DEFAULT FALSE, UNIQUE(alumno_id, numero_cuota));
    CREATE TABLE IF NOT EXISTS pagos (id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, alumno_id INTEGER NOT NULL, alumno_nombre TEXT NOT NULL, curso TEXT NOT NULL, monto NUMERIC NOT NULL, concepto TEXT NOT NULL, medio TEXT NOT NULL, origen TEXT NOT NULL, saldo_favor NUMERIC DEFAULT 0);
    CREATE TABLE IF NOT EXISTS aranceles (id SERIAL PRIMARY KEY, desde TEXT NOT NULL, descripcion TEXT DEFAULT '', creado TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS aranceles_precios (id SERIAL PRIMARY KEY, arancel_id INTEGER NOT NULL, alumno_id INTEGER NOT NULL, precio_normal NUMERIC DEFAULT 0, precio_bonificado NUMERIC DEFAULT 0);
    CREATE TABLE IF NOT EXISTS aranceles_cursos (id SERIAL PRIMARY KEY, arancel_id INTEGER NOT NULL, curso TEXT NOT NULL, precio_normal NUMERIC DEFAULT 0, precio_bonificado NUMERIC DEFAULT 0, UNIQUE(arancel_id, curso));
    CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
    ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS precio_especial BOOLEAN DEFAULT FALSE;
  `);
  const iniciado = await q1("SELECT valor FROM config WHERE clave='iniciado'");
  if (!iniciado) {
    if (!DEMO_MODE) await cargarDatosIniciales();
    else await q("INSERT INTO config (clave,valor) VALUES ('iniciado','demo') ON CONFLICT DO NOTHING");
  }
}

async function generarCuotas(alumnoId) {
  const mesActual = new Date().getMonth();
  for (let i = 0; i < MESES_IDX.length; i++) {
    if (MESES_IDX[i] <= mesActual) await q('INSERT INTO cuotas (alumno_id,numero_cuota,estado) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [alumnoId, i+1, 'pendiente']);
  }
}

async function cargarDatosIniciales() {
  const cursos = ['1ST','1ST INT','2ND YEAR','5TH INT','6TH INT','7TH INT','CHILDREN','FAMILIA','JUNIORS 3','JUNIORS 4','KIDS 1','KIDS 2','KIDS 3','PLAY 2','PLY1'];
  for (const c of cursos) await q('INSERT INTO cursos (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [c]);

  const alumnosData = [
    ['CARABAJAL ANA PAULA','1ST INT','',76000,73000],['MAURIN GIANA','1ST INT','',76000,73000],['MARTINEZ CARBAJO IVAN','1ST INT','23282612984',76000,73000],['NIEVA GUEMES MIA ISABELLA','1ST INT','',76000,73000],['BENICIO BELEN','1ST INT','27258005762',76000,73000],['CARI, NIRVANA','2ND YEAR','',55500,52500],['DIAZ LOLA','2ND YEAR','27267806093',55500,52500],['NUGHES, LEON','2ND YEAR','27306379599',55500,52500],['TRONCOSO ALMA','1ST','27365805771',55500,52500],['ALCALA, MATEO','5TH INT','',85500,81500],['APAZA BORELLI, VERONICA','5TH INT','27258929123',85500,81500],['GARCIA, NICOLE','5TH INT','27288309111',85500,81500],['GUZMAN, INAKI','5TH INT','20271755946',85500,81500],['LARA LUCIO','5TH INT','',85500,81500],['LOPEZ BERRUEZO, PILAR','5TH INT','27288676793',85500,81500],['RUSSO RADA, FRANCESCA','5TH INT','27282480781',85500,81500],['MORALES BELLIDO ALVARO','5TH INT','',85500,81500],['MARTINEZ RUIZ BAUTISTA','5TH INT','',85500,81500],['ALTOBELLI, ANA','6TH INT','27115395063',85500,81500],['MARTINEZ ARGANARAZ ARIEL','6TH INT','20258023685',85500,81500],['LOPEZ GARCIA VALENTINA','6TH INT','',85500,81500],['CARDENAS, ARACELI','6TH INT','20348469127',85500,81500],['MORALES, JUANA','6TH INT','27295951015',85500,81500],['MORALES, LAUTARO','6TH INT','',85500,73000],['VILLARREAL, MELANIE','6TH INT','',85500,81500],['VERCELLINO IGNACIO','6TH INT','',85500,81500],['PALACIOS ERNESTINA','6TH INT','',85500,81500],['CASAS, GUILLERMINA','7TH INT','23364482299',87000,82500],['DIAZ TORRES, JOSEFINA','7TH INT','27248759653',87000,82500],['LOPEZ, AGNES','7TH INT','27312280855',87000,82500],['MICOL, FRANCISCO','7TH INT','',87000,82500],['VITALE GUADALUPE','7TH INT','20254376699',87000,82500],['CAMACHO AMPARO','CHILDREN','',42500,40500],['CANABIDES, ALLEGRA','CHILDREN','27407097608',42500,40500],['FERNANDEZ AMARELIS','CHILDREN','27311264538',42500,40500],['LUNA, SANTINO','CHILDREN','',42500,40500],['NUNEZ, ALEXANDER','CHILDREN','27293369254',42500,40500],['QUIROGA AMPARO','CHILDREN','20320624321',42500,40500],['SOSA, SANTIAGO','CHILDREN','27303913721',42500,40500],['TOLABA CARABAJAL KARLA ARIANA','CHILDREN','27316391236',42500,40500],['ZARATE LUCIA','CHILDREN','27368022484',42500,40500],['ALVAREZ LOURDES','CHILDREN','20364482729,27137473769',42500,36200],['CABRERA AMADEO BENICIO','CHILDREN','',42500,36200],['GUANCA PATRICIO MATIAS FEDERICO','CHILDREN','27418299822',42500,36200],['CARRASCO, GAEL TIZIANO','CHILDREN','27376022752',42500,40500],['FLIA AMADO RUSSO','FAMILIA','',171000,155500],['FLIA BRITO','FAMILIA','27267018788',144500,132500],['FLIA COTINI','FAMILIA','27321621142',111000,100000],['FLIA CAYO E Y RAFAELA','FAMILIA','20288773433',112000,101500],['FLIA CAYO A Y TAIEL','FAMILIA','27254603614',146000,133500],['FLIA DIAZ MORALES','FAMILIA','23316390064',112000,95000],['FLIA LACURI','FAMILIA','27296663080',95500,87000],['FLIA MAMANI RUIZ','FAMILIA','27214634215',172500,156500],['FLIA MARTINEZ','FAMILIA','',82000,75500],['FLIA MOYA','FAMILIA','27319484596',144500,132500],['FLIA ORTEGA','FAMILIA','',133500,122500],['FLIA RAMIREZ ORTUNO','FAMILIA','20248024918',101500,92500],['FLIA RIVERO','FAMILIA','27319488230',144500,132500],['FLIA ROSAS','FAMILIA','27282480021',197500,170200],['FLIA RUANO','FAMILIA','',98000,89000],['FLIA OLIVEIRA BEJARANO','FAMILIA','',129500,119000],['FLIA SANTAFE','FAMILIA','',112000,101500],['FLIA GITIAN','FAMILIA','20346167697',140000,128000],['FLIA SARAVIA','FAMILIA','27282481516',138500,127000],['FLIA SUAREZ','FAMILIA','27334286733',95500,87000],['FLIA TACTAGI','FAMILIA','',144500,132500],['FLIA TEJERINA','FAMILIA','27255163413',146000,133500],['FLIA TOLABA','FAMILIA','27349603697',106000,96000],['FLIA VACA MONASTEROLO','FAMILIA','27315574353',172500,156500],['FLIA VERCELLINO R','FAMILIA','27301102025',95500,87000],['FLIA VILLAFANE GUITIAN','FAMILIA','27374198683',112000,101500],['FLIA LIENDRO','FAMILIA','27335819131',181000,167500],['FLIA CARI','FAMILIA','',107000,97000],['FLIA RIOS','FAMILIA','',145500,132500],['FLIA MARTINEZ ISAIAS TOBIAS','FAMILIA','27385076342',58000,52500],['FLIA GASPAR GUITIAN','FAMILIA','',141000,131500],['FLIA FECCIA','FAMILIA','20346477408',101000,95700],['FLIA RIOS THIAGO RUTH','FAMILIA','27368059000',138500,127000],['FLIA CASIMIRO','FAMILIA','',129000,118500],['ANTUNA MAITENA','JUNIORS 3','27292956849',59000,56000],['CABRAL SIMON','JUNIORS 3','20303571990',59000,56000],['CARDENAS, MAILEN','JUNIORS 3','',59000,56000],['CRUZ, LUDMILA','JUNIORS 3','',59000,56000],['GUANCA, YAHIR','JUNIORS 3','20310629171',59000,56000],['SORIA LIENDRO, LIA','JUNIORS 3','',59000,56000],['CRUZ, EMA ISABELLA','JUNIORS 3','',59000,56000],['ROJAS, JAZMIN','JUNIORS 3','27291201879',59000,56000],['REALES, LAUTARO','JUNIORS 3','27268670713',59000,56000],['SEGURA, VICTORIA','JUNIORS 3','23365052794',59000,56000],['SOTILLO CATALINA','JUNIORS 3','27343488276,27177350988',59000,56000],['YAPURA, BAUTISTA','JUNIORS 3','27363389053',59000,50000],['ROBLEDO MAXIMO','JUNIORS 3','27274659500',59000,56000],['LAIME, DAIANA','JUNIORS 4','27364483479',59000,56000],['ORELLANA, ORIANA','JUNIORS 4','',59000,56000],['RICCO, TIZIANO','JUNIORS 4','27318028066',59000,56000],['RODRIGUEZ, GENESIS','JUNIORS 4','',59000,56000],['TOLABA, JEREMIAS','JUNIORS 4','23292955154',59000,56000],['ALCALA BAUTISTA','JUNIORS 4','20341849560',59000,50000],['MOLINA GUADALUPE','JUNIORS 4','',59000,50000],['CARRASCO, MATEO','KIDS 1','27297913927',48000,45500],['CESPEDES PUPPI, JUAN EMILIO','KIDS 1','27244539683',48000,45500],['CHOQUE JESUS GABRIEL','KIDS 1','',48000,45500],['GARCIA CARBAJAL, VALENTINO GABRIEL','KIDS 1','',48000,45500],['FLORES LUCAS','KIDS 1','',48000,45500],['GERON CARMEN','KIDS 1','20367917238',48000,45500],['GUTIERREZ, EMMA','KIDS 1','27339705335',48000,45500],['MONTES, LOLA','KIDS 1','27316391112',48000,45500],['PARRILLA, VALENTINA','KIDS 1','',48000,45500],['POSADAS, JEREMIAS','KIDS 1','',48000,45500],['RIVERO, AGUSTIN','KIDS 1','',48000,45500],['SANGUEZO MIRANDA, LUZ','KIDS 1','27365365747',48000,45500],['TERCERO, MATEO','KIDS 1','',48000,45500],['VEDIA, FELIPE','KIDS 1','',48000,45500],['VELA, NAHIARA','KIDS 1','23405161184',48000,45500],['ZARATE FRANCESCA','KIDS 1','',48000,45500],['NERI SALVADOR','KIDS 1','27332356877',48000,45500],['CARMEN GUILLERMINA','KIDS 1','',48000,45500],['ABALOS, AYLEN','KIDS 3','',53000,50500],['ACOSTA MIA','KIDS 2','20313357563',53000,50500],['AGUILERA, MIA','KIDS 2','',53000,50500],['ANTONELLI, DONATO','KIDS 2','27328042105',53000,50500],['CAMPOS GIOVANI','KIDS 2','',53000,50500],['CASTRO, AGUSTIN','KIDS 2','27335929883',53000,50500],['GOMEZ, NAZARENO','KIDS 2','27252624207',53000,50500],['GUTIERREZ, ZOEMI','KIDS 2','27335929441',53000,45000],['PERALES, MARIA CECILIA','KIDS 2','27306922187',53000,50500],['PERCINO, NAHIARA','KIDS 2','',53000,50500],['TOLABA, ESTEFANIA','KIDS 2','20270840419',53000,50500],['TOMASINI AGUSTIN','KIDS 2','27285994786',53000,50500],['YURKINA, MISAEL','KIDS 2','27310629516',53000,45000],['VARGAS THIAGO','KIDS 2','27350272769',53000,50500],['TAGLIOLI ANA','KIDS 2','20250786728',53000,50500],['VILCA ESPERANZA','KIDS 2','',53000,50500],['FACCHIN, OLIVIA','KIDS 3','27339704258',53000,50500],['LOPEZ ESTEFANIA','KIDS 3','27377456756',53000,45000],['MANSILLA, ABRIL','KIDS 3','',53000,50500],['MONDAQUE SABRINA','KIDS 3','',53000,50500],['REMENTERIA ISABEL','KIDS 3','20259313172',53000,50500],['MOSA, TADEO','KIDS 3','24276610933',53000,50500],['OROZCO, LAUTARO','KIDS 3','27285769634',53000,50500],['ORTEGA MARCOS','KIDS 3','',53000,50500],['VILLANUEVA CARLOS','KIDS 3','27316392135',53000,50500],['GUAYMAS ZERPA, CIRO','KIDS 3','27279737615',53000,45000],['CABELLO ALMA','KIDS 3','20361302975',53000,45000],['FIRME TIZIANO','KIDS 3','27253759432',53000,45000],['CHAVEZ DI PAULI CATALINA','PLAY 2','20445017478',29000,27500],['MAMANI, FELICITAS','PLAY 2','27288676769',29000,27500],['ALANCAY DEMIR','PLAY 2','',29000,27500],['RAMPULLA, GINO','PLAY 2','27340666378',29000,27500],['ZERPA, MATHEO','PLAY 2','27392176336',29000,24700],['APARICIO ROYANO NAHYARA','PLAY 2','27304026672',29000,27500],['VILTE PAZ LORENA SOL','PLAY 2','',29000,27500],['CORONEL LAUTARO','PLY1','27390380335',29000,27500],['VILLANUEVA FRANCISCO','PLY1','27448181729',29000,27500]
  ];
  for (const a of alumnosData) await q('INSERT INTO alumnos (nombre,curso,cuits,precio_normal,precio_bonificado) VALUES ($1,$2,$3,$4,$5)', a);

  const mesActual = new Date().getMonth();
  const pagosHist = [{id:1,c:[true,true,false]},{id:2,c:[true,true,false]},{id:3,c:[true,true,false]},{id:4,c:[true,false,false]},{id:5,c:[true,true,true]},{id:6,c:[false,false,true]},{id:7,c:[true,true,true]},{id:8,c:[true,true,true]},{id:9,c:[true,true,false]},{id:10,c:[false,false,false]},{id:11,c:[true,true,true]},{id:12,c:[true,true,true]},{id:13,c:[false,true,true]},{id:14,c:[true,true,false]},{id:15,c:[true,true,true]},{id:16,c:[true,true,true]},{id:17,c:[true,true,true]},{id:18,c:[true,true,true]},{id:19,c:[true,true,true]},{id:20,c:[false,true,false]},{id:21,c:[false,false,false]},{id:22,c:[true,true,true]},{id:23,c:[true,true,true]},{id:24,c:[true,true,false]},{id:25,c:[true,true,true]},{id:26,c:[true,false,false]},{id:27,c:[true,true,true]},{id:28,c:[true,true,true]},{id:29,c:[true,true,false]},{id:30,c:[true,true,false]},{id:31,c:[false,false,false]},{id:32,c:[true,true,true]},{id:33,c:[true,true,false]},{id:34,c:[true,true,true]},{id:35,c:[false,true,true]},{id:36,c:[true,true,false]},{id:37,c:[true,true,true]},{id:38,c:[true,true,true]},{id:39,c:[true,true,true]},{id:40,c:[true,true,true]},{id:41,c:[true,true,true]},{id:42,c:[true,true,true]},{id:43,c:[true,true,false]},{id:44,c:[true,true,false]},{id:45,c:[true,true,false]},{id:46,c:[true,true,false]},{id:47,c:[true,true,true]},{id:48,c:[true,true,false]},{id:49,c:[true,true,true]},{id:50,c:[true,true,false]},{id:51,c:[true,true,false]},{id:52,c:[true,true,false]},{id:53,c:[true,true,false]},{id:54,c:[true,true,false]},{id:55,c:[false,true,false]},{id:56,c:[false,false,false]},{id:57,c:[true,true,true]},{id:58,c:[true,true,false]},{id:59,c:[true,true,true]},{id:60,c:[true,true,true]},{id:61,c:[false,true,true]},{id:62,c:[true,true,true]},{id:63,c:[true,true,true]},{id:64,c:[true,true,true]},{id:65,c:[true,true,true]},{id:66,c:[true,true,true]},{id:67,c:[true,true,true]},{id:68,c:[false,true,true]},{id:69,c:[true,true,true]},{id:70,c:[true,true,true]},{id:71,c:[true,true,true]},{id:72,c:[true,true,true]},{id:73,c:[true,true,false]},{id:74,c:[true,true,false]},{id:75,c:[true,true,true]},{id:76,c:[false,false,false]},{id:77,c:[true,true,true]},{id:78,c:[true,true,false]},{id:79,c:[true,true,false]},{id:80,c:[true,true,true]},{id:81,c:[true,true,true]},{id:82,c:[false,false,false]},{id:83,c:[false,false,false]},{id:84,c:[true,true,false]},{id:85,c:[true,true,true]},{id:86,c:[true,true,false]},{id:87,c:[false,true,true]},{id:88,c:[true,true,false]},{id:89,c:[true,true,false]},{id:90,c:[true,true,false]},{id:91,c:[true,true,true]},{id:92,c:[true,true,true]},{id:93,c:[true,true,true]},{id:94,c:[true,true,true]},{id:95,c:[true,true,true]},{id:96,c:[true,true,true]},{id:97,c:[true,true,true]},{id:98,c:[true,true,true]},{id:99,c:[false,false,false]},{id:100,c:[true,true,true]},{id:101,c:[true,true,true]},{id:102,c:[true,true,false]},{id:103,c:[true,false,false]},{id:104,c:[true,true,true]},{id:105,c:[false,true,false]},{id:106,c:[true,true,true]},{id:107,c:[true,true,true]},{id:108,c:[true,true,true]},{id:109,c:[true,true,true]},{id:110,c:[true,true,false]},{id:111,c:[true,true,true]},{id:112,c:[true,false,false]},{id:113,c:[true,true,true]},{id:114,c:[true,true,false]},{id:115,c:[true,true,false]},{id:116,c:[true,true,false]},{id:117,c:[true,true,false]},{id:118,c:[true,false,true]},{id:119,c:[true,true,true]},{id:120,c:[true,true,false]},{id:121,c:[true,true,false]},{id:122,c:[false,false,false]},{id:123,c:[true,true,false]},{id:124,c:[true,true,true]},{id:125,c:[true,true,true]},{id:126,c:[true,true,false]},{id:127,c:[true,true,true]},{id:128,c:[false,true,false]},{id:129,c:[true,true,true]},{id:130,c:[true,true,true]},{id:131,c:[false,true,false]},{id:132,c:[true,true,true]},{id:133,c:[true,true,true]},{id:134,c:[true,true,true]},{id:135,c:[true,true,false]},{id:136,c:[true,true,false]},{id:137,c:[true,true,true]},{id:138,c:[true,true,true]},{id:139,c:[true,true,true]},{id:140,c:[true,true,true]},{id:141,c:[true,false,false]},{id:142,c:[true,true,true]},{id:143,c:[true,true,true]},{id:144,c:[false,true,true]},{id:145,c:[true,true,true]},{id:146,c:[true,true,true]},{id:147,c:[true,true,false]},{id:148,c:[false,true,false]},{id:149,c:[true,true,true]},{id:150,c:[true,true,true]},{id:151,c:[true,true,true]},{id:152,c:[true,true,true]},{id:153,c:[true,true,true]},{id:154,c:[true,true,true]}];

  const FECHAS={"CARABAJAL ANA PAULA":{"1":"2026-03-31","2":"","3":""},"MAURIN GIANA":{"1":"2026-03-10","2":"2026-04-09","3":""},"MARTINEZ CARBAJO IVAN":{"1":"2026-03-12","2":"2026-04-09","3":""},"NIEVA GUEMES MIA ISABELLA":{"1":"2026-03-31","2":"","3":""},"BENICIO BELEN":{"1":"2026-03-21","2":"2026-04-09","3":"2026-05-08"},"CARI, NIRVANA":{"1":"","2":"","3":"2026-05-11"},"DIAZ LOLA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-09"},"NUGHES, LEON":{"1":"2026-03-02","2":"","3":"2026-05-12"},"TRONCOSO ALMA":{"1":"2026-03-26","2":"2026-04-23","3":""},"ALCALA, MATEO":{"1":"","2":"","3":""},"APAZA BORELLI, VERONICA":{"1":"2026-03-04","2":"2026-04-09","3":"2026-05-07"},"GARCIA, NICOLE":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-05"},"GUZMAN, INAKI":{"1":"","2":"2026-04-09","3":"2026-05-10"},"LARA LUCIO":{"1":"2026-04-07","2":"2026-04-07","3":""},"LOPEZ BERRUEZO, PILAR":{"1":"2026-03-12","2":"2026-04-09","3":"2026-05-11"},"RUSSO RADA, FRANCESCA":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-08"},"MORALES BELLIDO ALVARO":{"1":"2026-03-26","2":"2026-05-04","3":"2026-05-04"},"MARTINEZ RUIZ BAUTISTA":{"1":"2026-03-10","2":"2026-05-14","3":"2026-05-14"},"ALTOBELLI, ANA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-06"},"MARTINEZ ARGANARAZ ARIEL":{"1":"","2":"2026-04-13","3":""},"LOPEZ GARCIA VALENTINA":{"1":"","2":"","3":""},"CARDENAS, ARACELI":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-11"},"MORALES, JUANA":{"1":"2026-03-12","2":"2026-04-07","3":"2026-05-05"},"MORALES, LAUTARO":{"1":"2026-03-09","2":"2026-04-06","3":""},"VILLARREAL, MELANIE":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"VERCELLINO IGNACIO":{"1":"2026-04-06","2":"","3":""},"PALACIOS ERNESTINA":{"1":"2026-03-09","2":"2026-03-31","3":"2026-05-05"},"CASAS, GUILLERMINA":{"1":"2026-03-02","2":"2026-04-01","3":"2026-05-01"},"DIAZ TORRES, JOSEFINA":{"1":"2026-03-03","2":"","3":""},"LOPEZ, AGNES":{"1":"2026-03-09","2":"2026-04-30","3":""},"MICOL, FRANCISCO":{"1":"","2":"","3":""},"VITALE GUADALUPE":{"1":"2026-03-09","2":"2026-04-07","3":"2026-05-08"},"CAMACHO AMPARO":{"1":"2026-03-17","2":"2026-04-09","3":""},"CANABIDES, ALLEGRA":{"1":"2026-03-19","2":"2026-04-09","3":"2026-05-11"},"FERNANDEZ AMARELIS":{"1":"","2":"2026-04-15","3":"2026-05-14"},"LUNA, SANTINO":{"1":"2026-03-17","2":"2026-04-09","3":""},"NUNEZ, ALEXANDER":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-05"},"QUIROGA AMPARO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"SOSA, SANTIAGO":{"1":"2026-03-03","2":"2026-04-01","3":"2026-05-05"},"TOLABA CARABAJAL KARLA ARIANA":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-07"},"ZARATE LUCIA":{"1":"2026-03-05","2":"2026-04-09","3":"2026-05-11"},"ALVAREZ LOURDES":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-07"},"CABRERA AMADEO BENICIO":{"1":"2026-04-14","2":"2026-04-16","3":""},"GUANCA PATRICIO MATIAS FEDERICO":{"1":"2026-03-19","2":"2026-04-09","3":""},"CARRASCO, GAEL TIZIANO":{"1":"2026-03-02","2":"2026-04-15","3":""},"FLIA AMADO RUSSO":{"1":"2026-03-02","2":"2026-04-06","3":""},"FLIA BRITO":{"1":"","2":"2026-04-23","3":"2026-05-12"},"FLIA COTINI":{"1":"2026-03-26","2":"2026-04-30","3":""},"FLIA CAYO E Y RAFAELA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-09"},"FLIA CAYO A Y TAIEL":{"1":"2026-03-04","2":"2026-04-01","3":""},"FLIA DIAZ MORALES":{"1":"2026-03-10","2":"2026-04-09","3":""},"FLIA LACURI":{"1":"2026-03-03","2":"2026-04-09","3":""},"FLIA MAMANI RUIZ":{"1":"2026-03-04","2":"2026-03-30","3":""},"FLIA MARTINEZ":{"1":"2026-04-06","2":"2026-04-06","3":""},"FLIA MOYA":{"1":"","2":"2026-04-19","3":""},"FLIA ORTEGA":{"1":"","2":"","3":""},"FLIA RAMIREZ ORTUNO":{"1":"2026-03-12","2":"2026-04-09","3":"2026-05-11"},"FLIA RIVERO":{"1":"2026-03-05","2":"2026-04-08","3":""},"FLIA ROSAS":{"1":"2026-03-05","2":"2026-04-07","3":"2026-05-03"},"FLIA RUANO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-06"},"FLIA OLIVEIRA BEJARANO":{"1":"","2":"2026-04-07","3":"2026-05-11"},"FLIA SANTAFE":{"1":"2026-03-03","2":"2026-04-09","3":"2026-05-06"},"FLIA GITIAN":{"1":"2026-04-07","2":"2026-04-07","3":"2026-05-11"},"FLIA SARAVIA":{"1":"2026-03-31","2":"2026-04-10","3":"2026-05-04"},"FLIA SUAREZ":{"1":"2026-03-11","2":"2026-04-09","3":"2026-05-11"},"FLIA TACTAGI":{"1":"2026-03-05","2":"2026-04-06","3":"2026-05-06"},"FLIA TEJERINA":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-10"},"FLIA TOLABA":{"1":"","2":"2026-04-09","3":"2026-05-11"},"FLIA VACA MONASTEROLO":{"1":"2026-03-05","2":"2026-04-08","3":"2026-05-05"},"FLIA VERCELLINO R":{"1":"2026-03-04","2":"2026-04-04","3":"2026-05-02"},"FLIA VILLAFANE GUITIAN":{"1":"2026-03-08","2":"2026-04-07","3":"2026-05-08"},"FLIA LIENDRO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"FLIA CARI":{"1":"2026-03-09","2":"2026-04-01","3":""},"FLIA RIOS":{"1":"2026-03-09","2":"2026-04-07","3":""},"FLIA MARTINEZ ISAIAS TOBIAS":{"1":"2026-03-10","2":"2026-04-08","3":"2026-05-11"},"FLIA GASPAR GUITIAN":{"1":"","2":"","3":""},"FLIA FECCIA":{"1":"2026-03-31","2":"2026-04-08","3":"2026-05-11"},"FLIA RIOS THIAGO RUTH":{"1":"2026-03-31","2":"2026-04-13","3":""},"FLIA CASIMIRO":{"1":"2026-03-13","2":"2026-04-20","3":""},"ANTUNA MAITENA":{"1":"2026-03-05","2":"2026-04-05","3":"2026-05-04"},"CABRAL SIMON":{"1":"2026-03-03","2":"2026-04-09","3":"2026-05-06"},"CARDENAS, MAILEN":{"1":"","2":"","3":""},"CRUZ, LUDMILA":{"1":"","2":"","3":""},"GUANCA, YAHIR":{"1":"2026-03-09","2":"2026-04-09","3":""},"SORIA LIENDRO, LIA":{"1":"2026-03-10","2":"2026-05-13","3":"2026-05-13"},"CRUZ, EMA ISABELLA":{"1":"2026-05-11","2":"2026-05-11","3":""},"ROJAS, JAZMIN":{"1":"","2":"2026-04-09","3":"2026-05-08"},"REALES, LAUTARO":{"1":"","2":"2026-04-27","3":""},"SEGURA, VICTORIA":{"1":"2026-03-09","2":"2026-04-08","3":""},"SOTILLO CATALINA":{"1":"2026-03-15","2":"2026-04-09","3":""},"YAPURA, BAUTISTA":{"1":"2026-03-06","2":"2026-04-09","3":"2026-05-04"},"ROBLEDO MAXIMO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-10"},"LAIME, DAIANA":{"1":"2026-03-04","2":"2026-04-08","3":"2026-05-04"},"ORELLANA, ORIANA":{"1":"2026-03-20","2":"2026-04-07","3":"2026-05-08"},"RICCO, TIZIANO":{"1":"2026-03-04","2":"2026-04-07","3":"2026-05-06"},"RODRIGUEZ, GENESIS":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-04"},"TOLABA, JEREMIAS":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"ALCALA BAUTISTA":{"1":"2026-03-06","2":"2026-04-07","3":"2026-05-07"},"MOLINA GUADALUPE":{"1":"","2":"","3":""},"CARRASCO, MATEO":{"1":"2026-03-04","2":"2026-04-01","3":"2026-05-05"},"CESPEDES PUPPI, JUAN EMILIO":{"1":"2026-03-03","2":"2026-04-08","3":"2026-05-05"},"CHOQUE JESUS GABRIEL":{"1":"2026-03-10","2":"2026-04-16","3":""},"GARCIA CARBAJAL, VALENTINO GABRIEL":{"1":"2026-03-31","2":"","3":""},"FLORES LUCAS":{"1":"2026-03-09","2":"2026-04-13","3":"2026-04-13"},"GERON CARMEN":{"1":"","2":"2026-04-14","3":""},"GUTIERREZ, EMMA":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-07"},"MONTES, LOLA":{"1":"2026-03-10","2":"2026-04-08","3":"2026-05-06"},"PARRILLA, VALENTINA":{"1":"2026-03-05","2":"2026-04-09","3":"2026-05-14"},"POSADAS, JEREMIAS":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"RIVERO, AGUSTIN":{"1":"2026-03-05","2":"2026-04-07","3":""},"SANGUEZO MIRANDA, LUZ":{"1":"2026-03-31","2":"2026-04-08","3":"2026-05-12"},"TERCERO, MATEO":{"1":"2026-04-06","2":"","3":""},"VEDIA, FELIPE":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-04"},"VELA, NAHIARA":{"1":"2026-03-09","2":"2026-04-09","3":""},"ZARATE FRANCESCA":{"1":"2026-04-09","2":"2026-04-09","3":""},"NERI SALVADOR":{"1":"2026-04-09","2":"2026-04-09","3":""},"CARMEN GUILLERMINA":{"1":"2026-04-09","2":"2026-04-09","3":""},"ABALOS, AYLEN":{"1":"2026-03-09","2":"","3":"2026-05-11"},"ACOSTA MIA":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-07"},"AGUILERA, MIA":{"1":"2026-03-02","2":"2026-04-01","3":""},"ANTONELLI, DONATO":{"1":"2026-03-10","2":"2026-04-09","3":""},"CAMPOS GIOVANI":{"1":"","2":"","3":""},"CASTRO, AGUSTIN":{"1":"2026-03-05","2":"2026-04-28","3":""},"GOMEZ, NAZARENO":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-04"},"GUTIERREZ, ZOEMI":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-10"},"PERALES, MARIA CECILIA":{"1":"2026-03-02","2":"2026-04-09","3":""},"PERCINO, NAHIARA":{"1":"2026-03-17","2":"2026-04-16","3":"2026-05-14"},"TOLABA, ESTEFANIA":{"1":"","2":"2026-04-27","3":""},"TOMASINI AGUSTIN":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-05"},"YURKINA, MISAEL":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"VARGAS THIAGO":{"1":"","2":"2026-04-09","3":""},"TAGLIOLI ANA":{"1":"2026-03-30","2":"2026-04-08","3":"2026-05-06"},"VILCA ESPERANZA":{"1":"2026-03-17","2":"2026-04-08","3":"2026-05-06"},"FACCHIN, OLIVIA":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"LOPEZ ESTEFANIA":{"1":"2026-04-09","2":"2026-04-09","3":""},"MANSILLA, ABRIL":{"1":"2026-03-10","2":"2026-03-31","3":""},"MONDAQUE SABRINA":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"REMENTERIA ISABEL":{"1":"2026-03-31","2":"2026-04-09","3":"2026-05-07"},"MOSA, TADEO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-05"},"OROZCO, LAUTARO":{"1":"2026-03-06","2":"2026-04-07","3":"2026-05-07"},"ORTEGA MARCOS":{"1":"2026-04-20","2":"","3":""},"VILLANUEVA CARLOS":{"1":"2026-03-04","2":"2026-04-07","3":"2026-05-05"},"GUAYMAS ZERPA, CIRO":{"1":"2026-03-06","2":"2026-04-09","3":"2026-05-11"},"CABELLO ALMA":{"1":"","2":"2026-04-09","3":"2026-05-09"},"FIRME TIZIANO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-04"},"CHAVEZ DI PAULI CATALINA":{"1":"2026-03-03","2":"2026-04-06","3":"2026-05-08"},"MAMANI, FELICITAS":{"1":"2026-03-19","2":"2026-04-20","3":""},"ALANCAY DEMIR":{"1":"","2":"2026-04-09","3":""},"RAMPULLA, GINO":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-08"},"ZERPA, MATHEO":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-07"},"APARICIO ROYANO NAHYARA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"VILTE PAZ LORENA SOL":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-05"},"CORONEL LAUTARO":{"1":"2026-03-26","2":"2026-04-09","3":"2026-05-06"},"VILLANUEVA FRANCISCO":{"1":"2026-04-13","2":"2026-04-09","3":"2026-05-11"}};
  const MONTOS={"CARABAJAL ANA PAULA":{"1":73000,"2":0,"3":0},"MAURIN GIANA":{"1":73000,"2":73000,"3":0},"MARTINEZ CARBAJO IVAN":{"1":73000,"2":73000,"3":0},"NIEVA GUEMES MIA ISABELLA":{"1":73000,"2":0,"3":0},"BENICIO BELEN":{"1":73000,"2":73000,"3":73000},"CARI, NIRVANA":{"1":0,"2":0,"3":52500},"DIAZ LOLA":{"1":52500,"2":52500,"3":52500},"NUGHES, LEON":{"1":52500,"2":52500,"3":52500},"TRONCOSO ALMA":{"1":52500,"2":55000,"3":0},"ALCALA, MATEO":{"1":0,"2":0,"3":0},"APAZA BORELLI, VERONICA":{"1":81500,"2":81500,"3":81500},"GARCIA, NICOLE":{"1":81500,"2":81500,"3":81500},"GUZMAN, INAKI":{"1":0,"2":81500,"3":81500},"LARA LUCIO":{"1":85500,"2":81500,"3":0},"LOPEZ BERRUEZO, PILAR":{"1":81500,"2":81500,"3":81500},"RUSSO RADA, FRANCESCA":{"1":81500,"2":81500,"3":81500},"MORALES BELLIDO ALVARO":{"1":81500,"2":81500,"3":4000},"MARTINEZ RUIZ BAUTISTA":{"1":81500,"2":81500,"3":81500},"ALTOBELLI, ANA":{"1":81500,"2":81500,"3":81500},"MARTINEZ ARGANARAZ ARIEL":{"1":0,"2":171000,"3":0},"LOPEZ GARCIA VALENTINA":{"1":0,"2":0,"3":0},"CARDENAS, ARACELI":{"1":81500,"2":81500,"3":81500},"MORALES, JUANA":{"1":85500,"2":81500,"3":81500},"MORALES, LAUTARO":{"1":73000,"2":73000,"3":0},"VILLARREAL, MELANIE":{"1":81500,"2":81500,"3":81500},"VERCELLINO IGNACIO":{"1":85500,"2":0,"3":0},"PALACIOS ERNESTINA":{"1":81500,"2":81500,"3":81500},"CASAS, GUILLERMINA":{"1":82500,"2":82500,"3":82500},"DIAZ TORRES, JOSEFINA":{"1":82500,"2":82500,"3":0},"LOPEZ, AGNES":{"1":82500,"2":82500,"3":0},"MICOL, FRANCISCO":{"1":0,"2":0,"3":0},"VITALE GUADALUPE":{"1":133000,"2":82500,"3":82500},"CAMACHO AMPARO":{"1":40500,"2":40500,"3":0},"CANABIDES, ALLEGRA":{"1":40500,"2":40500,"3":40500},"FERNANDEZ AMARELIS":{"1":0,"2":42500,"3":42500},"LUNA, SANTINO":{"1":40500,"2":40500,"3":0},"NUNEZ, ALEXANDER":{"1":40500,"2":40500,"3":40500},"QUIROGA AMPARO":{"1":40500,"2":40500,"3":40500},"SOSA, SANTIAGO":{"1":40500,"2":40500,"3":40500},"TOLABA CARABAJAL KARLA ARIANA":{"1":40500,"2":40500,"3":40500},"ZARATE LUCIA":{"1":40500,"2":40500,"3":40000},"ALVAREZ LOURDES":{"1":40500,"2":40500,"3":40500},"CABRERA AMADEO BENICIO":{"1":42500,"2":42500,"3":0},"GUANCA PATRICIO MATIAS FEDERICO":{"1":40500,"2":40500,"3":0},"CARRASCO, GAEL TIZIANO":{"1":40500,"2":42500,"3":0},"FLIA AMADO RUSSO":{"1":155500,"2":155500,"3":0},"FLIA BRITO":{"1":132500,"2":144500,"3":132500},"FLIA COTINI":{"1":100000,"2":100000,"3":0},"FLIA CAYO E Y RAFAELA":{"1":101500,"2":101500,"3":101500},"FLIA CAYO A Y TAIEL":{"1":133000,"2":267000,"3":0},"FLIA DIAZ MORALES":{"1":95000,"2":95000,"3":0},"FLIA LACURI":{"1":87000,"2":87000,"3":0},"FLIA MAMANI RUIZ":{"1":156500,"2":156500,"3":0},"FLIA MARTINEZ":{"1":82000,"2":75500,"3":0},"FLIA MOYA":{"1":0,"2":144500,"3":0},"FLIA ORTEGA":{"1":0,"2":0,"3":0},"FLIA RAMIREZ ORTUNO":{"1":92500,"2":92500,"3":92500},"FLIA RIVERO":{"1":132500,"2":132500,"3":0},"FLIA ROSAS":{"1":170500,"2":170500,"3":170500},"FLIA RUANO":{"1":89000,"2":89000,"3":89000},"FLIA OLIVEIRA BEJARANO":{"1":0,"2":118500,"3":119000},"FLIA SANTAFE":{"1":101500,"2":101500,"3":101500},"FLIA GITIAN":{"1":87000,"2":261000,"3":128000},"FLIA SARAVIA":{"1":127000,"2":127000,"3":127000},"FLIA SUAREZ":{"1":87000,"2":87000,"3":87000},"FLIA TACTAGI":{"1":132500,"2":132500,"3":132500},"FLIA TEJERINA":{"1":133000,"2":133000,"3":133000},"FLIA TOLABA":{"1":0,"2":202000,"3":106000},"FLIA VACA MONASTEROLO":{"1":156000,"2":156000,"3":156000},"FLIA VERCELLINO R":{"1":87000,"2":87000,"3":89000},"FLIA VILLAFANE GUITIAN":{"1":101500,"2":101500,"3":101500},"FLIA LIENDRO":{"1":167500,"2":167500,"3":167500},"FLIA CARI":{"1":101200,"2":97000,"3":0},"FLIA RIOS":{"1":132500,"2":132500,"3":0},"FLIA MARTINEZ ISAIAS TOBIAS":{"1":52500,"2":52500,"3":52500},"FLIA GASPAR GUITIAN":{"1":0,"2":0,"3":0},"FLIA FECCIA":{"1":91500,"2":91500,"3":91500},"FLIA RIOS THIAGO RUTH":{"1":154000,"2":138500,"3":0},"FLIA CASIMIRO":{"1":118000,"2":129000,"3":0},"ANTUNA MAITENA":{"1":56000,"2":50000,"3":50000},"CABRAL SIMON":{"1":56000,"2":56000,"3":56000},"CARDENAS, MAILEN":{"1":0,"2":0,"3":0},"CRUZ, LUDMILA":{"1":0,"2":0,"3":0},"GUANCA, YAHIR":{"1":56000,"2":56000,"3":0},"SORIA LIENDRO, LIA":{"1":56000,"2":56000,"3":56000},"CRUZ, EMA ISABELLA":{"1":56000,"2":5950,"3":0},"ROJAS, JAZMIN":{"1":0,"2":56000,"3":56000},"REALES, LAUTARO":{"1":59000,"2":59000,"3":0},"SEGURA, VICTORIA":{"1":56000,"2":56000,"3":0},"SOTILLO CATALINA":{"1":59000,"2":56000,"3":0},"YAPURA, BAUTISTA":{"1":56000,"2":50000,"3":50000},"ROBLEDO MAXIMO":{"1":56000,"2":56000,"3":56000},"LAIME, DAIANA":{"1":56000,"2":56000,"3":112000},"ORELLANA, ORIANA":{"1":56000,"2":56000,"3":56000},"RICCO, TIZIANO":{"1":56000,"2":56000,"3":112000},"RODRIGUEZ, GENESIS":{"1":56000,"2":56000,"3":56000},"TOLABA, JEREMIAS":{"1":56000,"2":56000,"3":56000},"ALCALA BAUTISTA":{"1":56000,"2":56000,"3":56000},"MOLINA GUADALUPE":{"1":0,"2":0,"3":0},"CARRASCO, MATEO":{"1":45500,"2":45500,"3":45500},"CESPEDES PUPPI, JUAN EMILIO":{"1":45500,"2":45500,"3":45500},"CHOQUE JESUS GABRIEL":{"1":45500,"2":48000,"3":0},"GARCIA CARBAJAL, VALENTINO GABRIEL":{"1":45500,"2":0,"3":0},"FLORES LUCAS":{"1":45500,"2":48000,"3":45500},"GERON CARMEN":{"1":0,"2":96000,"3":0},"GUTIERREZ, EMMA":{"1":45500,"2":45500,"3":45500},"MONTES, LOLA":{"1":45500,"2":45500,"3":45000},"PARRILLA, VALENTINA":{"1":45500,"2":45500,"3":45500},"POSADAS, JEREMIAS":{"1":45500,"2":45500,"3":45500},"RIVERO, AGUSTIN":{"1":45500,"2":45500,"3":0},"SANGUEZO MIRANDA, LUZ":{"1":45500,"2":91000,"3":45500},"TERCERO, MATEO":{"1":48000,"2":0,"3":0},"VEDIA, FELIPE":{"1":45500,"2":45500,"3":45500},"VELA, NAHIARA":{"1":45500,"2":45500,"3":0},"ZARATE FRANCESCA":{"1":45500,"2":45500,"3":0},"NERI SALVADOR":{"1":45500,"2":45500,"3":0},"CARMEN GUILLERMINA":{"1":48000,"2":45500,"3":0},"ABALOS, AYLEN":{"1":50500,"2":0,"3":50500},"ACOSTA MIA":{"1":50500,"2":50500,"3":50500},"AGUILERA, MIA":{"1":50500,"2":50500,"3":0},"ANTONELLI, DONATO":{"1":50500,"2":50500,"3":0},"CAMPOS GIOVANI":{"1":0,"2":0,"3":0},"CASTRO, AGUSTIN":{"1":50500,"2":50500,"3":0},"GOMEZ, NAZARENO":{"1":50500,"2":50500,"3":50500},"GUTIERREZ, ZOEMI":{"1":45500,"2":45000,"3":45000},"PERALES, MARIA CECILIA":{"1":50500,"2":50500,"3":0},"PERCINO, NAHIARA":{"1":50500,"2":53000,"3":50500},"TOLABA, ESTEFANIA":{"1":0,"2":53000,"3":0},"TOMASINI AGUSTIN":{"1":50500,"2":50500,"3":50500},"YURKINA, MISAEL":{"1":45000,"2":45500,"3":45500},"VARGAS THIAGO":{"1":0,"2":50500,"3":0},"TAGLIOLI ANA":{"1":53000,"2":50500,"3":50500},"VILCA ESPERANZA":{"1":50500,"2":50500,"3":50500},"FACCHIN, OLIVIA":{"1":50500,"2":50500,"3":50500},"LOPEZ ESTEFANIA":{"1":111000,"2":90000,"3":0},"MANSILLA, ABRIL":{"1":50500,"2":50500,"3":0},"MONDAQUE SABRINA":{"1":50500,"2":50500,"3":50500},"REMENTERIA ISABEL":{"1":93000,"2":50500,"3":50500},"MOSA, TADEO":{"1":50500,"2":50500,"3":50500},"OROZCO, LAUTARO":{"1":50500,"2":50500,"3":50500},"ORTEGA MARCOS":{"1":53000,"2":0,"3":0},"VILLANUEVA CARLOS":{"1":50500,"2":50500,"3":50500},"GUAYMAS ZERPA, CIRO":{"1":45000,"2":45000,"3":45000},"CABELLO ALMA":{"1":0,"2":50500,"3":53000},"FIRME TIZIANO":{"1":53000,"2":50500,"3":50500},"CHAVEZ DI PAULI CATALINA":{"1":29000,"2":27500,"3":27500},"MAMANI, FELICITAS":{"1":27500,"2":29000,"3":0},"ALANCAY DEMIR":{"1":0,"2":27500,"3":0},"RAMPULLA, GINO":{"1":27500,"2":27500,"3":27500},"ZERPA, MATHEO":{"1":24700,"2":24700,"3":24700},"APARICIO ROYANO NAHYARA":{"1":27500,"2":27500,"3":27500},"VILTE PAZ LORENA SOL":{"1":27500,"2":27500,"3":27500},"CORONEL LAUTARO":{"1":29000,"2":27500,"3":27500},"VILLANUEVA FRANCISCO":{"1":29000,"2":25000,"3":27500}};

  const alumnos = await q('SELECT id,nombre FROM alumnos ORDER BY id');
  for (let i = 0; i < pagosHist.length; i++) {
    const p = pagosHist[i];
    const alumno = alumnos[i];
    if (!alumno) continue;
    const nombre = alumno.nombre;
    const fa = FECHAS[nombre]||{};
    const ma = MONTOS[nombre]||{};
    for (let n = 1; n <= 10; n++) {
      const mi = MESES_IDX[n-1];
      if (mi <= mesActual) {
        let estado='pendiente', fp='', mp=0;
        if (n<=3 && p.c[n-1]) { estado='pagada'; fp=fa[String(n)]||''; mp=ma[String(n)]||0; }
        await q('INSERT INTO cuotas (alumno_id,numero_cuota,estado,fecha_pago,monto_pagado) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [alumno.id,n,estado,fp,mp]);
        if (estado==='pagada') {
          const fecha = fp || `2026-0${mi+1}-01`;
          await q('INSERT INTO pagos (fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen) SELECT $1,$2,a.nombre,a.curso,$3,$4,$5,$6 FROM alumnos a WHERE a.id=$2', [fecha,alumno.id,mp,`Cuota ${n} (${MESES_NOMBRE_ALL[n-1]} 2026)`,'Importado','Importado desde planilla']);
        }
      }
    }
  }
  await q("INSERT INTO config (clave,valor) VALUES ('iniciado','1') ON CONFLICT DO NOTHING");
}

// RUTAS
// Migrar datos a Supabase
app.post('/api/migrar-a-supabase', async (req, res) => {
  const { supabaseUrl } = req.body;
  if (!supabaseUrl) return res.json({ ok: false, error: 'Falta supabaseUrl' });

  try {
    const { Pool: PgPool } = require('pg');
    const dest = new PgPool({ connectionString: supabaseUrl, ssl: { rejectUnauthorized: false } });

    // Crear tablas en destino
    await dest.query(`
      CREATE TABLE IF NOT EXISTS cursos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, activo BOOLEAN DEFAULT TRUE);
      CREATE TABLE IF NOT EXISTS alumnos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, curso TEXT NOT NULL, cuits TEXT DEFAULT '', precio_normal NUMERIC DEFAULT 0, precio_bonificado NUMERIC DEFAULT 0, activo BOOLEAN DEFAULT TRUE, telefono TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS cuotas (id SERIAL PRIMARY KEY, alumno_id INTEGER NOT NULL, numero_cuota INTEGER NOT NULL, estado TEXT DEFAULT 'pendiente', fecha_pago TEXT DEFAULT '', monto_pagado NUMERIC DEFAULT 0, compensada BOOLEAN DEFAULT FALSE, UNIQUE(alumno_id, numero_cuota));
      CREATE TABLE IF NOT EXISTS pagos (id SERIAL PRIMARY KEY, fecha TEXT NOT NULL, alumno_id INTEGER NOT NULL, alumno_nombre TEXT NOT NULL, curso TEXT NOT NULL, monto NUMERIC NOT NULL, concepto TEXT NOT NULL, medio TEXT NOT NULL, origen TEXT NOT NULL, saldo_favor NUMERIC DEFAULT 0);
      CREATE TABLE IF NOT EXISTS aranceles (id SERIAL PRIMARY KEY, desde TEXT NOT NULL, descripcion TEXT DEFAULT '', creado TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS aranceles_precios (id SERIAL PRIMARY KEY, arancel_id INTEGER NOT NULL, alumno_id INTEGER NOT NULL, precio_normal NUMERIC DEFAULT 0, precio_bonificado NUMERIC DEFAULT 0);
      CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
    `);

    // Exportar datos del origen
    const cursos = await q('SELECT * FROM cursos ORDER BY id');
    const alumnos = await q('SELECT * FROM alumnos ORDER BY id');
    const cuotas = await q('SELECT * FROM cuotas ORDER BY id');
    const pagos = await q('SELECT * FROM pagos ORDER BY id');

    // Limpiar destino
    await dest.query('TRUNCATE pagos, cuotas, alumnos, cursos, config RESTART IDENTITY CASCADE');

    // Insertar cursos
    for (const c of cursos) {
      await dest.query('INSERT INTO cursos (id, nombre, activo) VALUES ($1,$2,$3)', [c.id, c.nombre, c.activo]);
    }
    await dest.query(`SELECT setval('cursos_id_seq', (SELECT MAX(id) FROM cursos))`);

    // Insertar alumnos
    for (const a of alumnos) {
      await dest.query('INSERT INTO alumnos (id,nombre,curso,cuits,precio_normal,precio_bonificado,activo,telefono) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [a.id,a.nombre,a.curso,a.cuits,a.precio_normal,a.precio_bonificado,a.activo,a.telefono]);
    }
    await dest.query(`SELECT setval('alumnos_id_seq', (SELECT MAX(id) FROM alumnos))`);

    // Insertar cuotas
    for (const c of cuotas) {
      await dest.query('INSERT INTO cuotas (id,alumno_id,numero_cuota,estado,fecha_pago,monto_pagado,compensada) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.id,c.alumno_id,c.numero_cuota,c.estado,c.fecha_pago,c.monto_pagado,c.compensada]);
    }
    await dest.query(`SELECT setval('cuotas_id_seq', (SELECT MAX(id) FROM cuotas))`);

    // Insertar pagos
    for (const p of pagos) {
      await dest.query('INSERT INTO pagos (id,fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen,saldo_favor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [p.id,p.fecha,p.alumno_id,p.alumno_nombre,p.curso,p.monto,p.concepto,p.medio,p.origen,p.saldo_favor]);
    }
    await dest.query(`SELECT setval('pagos_id_seq', (SELECT MAX(id) FROM pagos))`);

    // Marcar como iniciado
    await dest.query("INSERT INTO config (clave,valor) VALUES ('iniciado','true') ON CONFLICT DO NOTHING");

    await dest.end();
    res.json({ ok: true, cursos: cursos.length, alumnos: alumnos.length, cuotas: cuotas.length, pagos: pagos.length });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// Exportar todos los datos para migración
app.get('/api/exportar/todo', async (req,res) => {
  const alumnos = await q('SELECT * FROM alumnos ORDER BY id');
  const cuotas = await q('SELECT * FROM cuotas ORDER BY id');
  const pagos = await q('SELECT * FROM pagos ORDER BY id');
  const cursos = await q('SELECT * FROM cursos ORDER BY id');
  const aranceles = await q('SELECT * FROM aranceles ORDER BY id');
  const aranceles_precios = await q('SELECT * FROM aranceles_precios ORDER BY id');
  res.json({ alumnos, cuotas, pagos, cursos, aranceles, aranceles_precios, exportado: new Date().toISOString() });
});

app.get('/api/demo-info', (req,res) => {
  res.json({ demo: DEMO_MODE, maxAlumnos: DEMO_MAX_ALUMNOS });
});

app.get('/api/cursos', async (req,res) => { res.json(await q('SELECT * FROM cursos WHERE activo=TRUE ORDER BY nombre')); });
app.post('/api/cursos', async (req,res) => { const r=await q('INSERT INTO cursos (nombre) VALUES ($1) RETURNING id',[req.body.nombre.trim().toUpperCase()]); res.json({ok:true,id:r[0].id}); });
app.delete('/api/cursos/:id', async (req,res) => { await q('UPDATE cursos SET activo=FALSE WHERE id=$1',[req.params.id]); res.json({ok:true}); });

app.get('/api/alumnos', async (req,res) => { res.json(await q('SELECT * FROM alumnos ORDER BY nombre')); });
app.post('/api/alumnos', async (req,res) => {
  // Límite demo
  if (DEMO_MODE) {
    const count = await q1('SELECT COUNT(*) as n FROM alumnos WHERE activo=TRUE');
    if (parseInt(count?.n||0) >= DEMO_MAX_ALUMNOS) {
      return res.json({ ok: false, error: `Versión demo limitada a ${DEMO_MAX_ALUMNOS} alumnos` });
    }
  }
  const {nombre,curso,cuits,precio_normal,precio_bonificado,telefono}=req.body;
  const r=await q('INSERT INTO alumnos (nombre,curso,cuits,precio_normal,precio_bonificado,telefono) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[nombre.trim().toUpperCase(),curso,cuits||'',precio_normal||0,precio_bonificado||0,telefono||'']);
  await generarCuotas(r[0].id); res.json({ok:true,id:r[0].id});
});
app.put('/api/alumnos/:id', async (req,res) => {
  const {nombre,curso,cuits,precio_normal,precio_bonificado,telefono}=req.body;
  await q('UPDATE alumnos SET nombre=$1,curso=$2,cuits=$3,precio_normal=$4,precio_bonificado=$5,telefono=$6 WHERE id=$7',[nombre.trim().toUpperCase(),curso,cuits||'',precio_normal||0,precio_bonificado||0,telefono||'',req.params.id]);
  res.json({ok:true});
});
app.patch('/api/alumnos/:id/baja', async (req,res) => { await q('UPDATE alumnos SET activo=FALSE WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.patch('/api/alumnos/:id/alta', async (req,res) => { await q('UPDATE alumnos SET activo=TRUE WHERE id=$1',[req.params.id]); res.json({ok:true}); });

app.get('/api/cuotas/:alumnoId', async (req,res) => { res.json(await q('SELECT * FROM cuotas WHERE alumno_id=$1 ORDER BY numero_cuota',[req.params.alumnoId])); });

app.get('/api/pagos', async (req,res) => { res.json(await q('SELECT * FROM pagos ORDER BY id DESC')); });
app.get('/api/exportar/pagos', async (req,res) => { res.json(await q('SELECT * FROM pagos ORDER BY id')); });

app.put('/api/pagos/:id', async (req,res) => {
  const {monto,concepto,medio,fecha}=req.body;
  await q('UPDATE pagos SET monto=$1,concepto=$2,medio=$3,fecha=$4 WHERE id=$5',[monto,concepto,medio,fecha,req.params.id]);
  res.json({ok:true});
});

app.delete('/api/pagos/:id', async (req,res) => {
  const revertir=req.query.revertir==='1';
  const pago=await q1('SELECT * FROM pagos WHERE id=$1',[req.params.id]);
  if(!pago) return res.json({ok:false});
  if(revertir) {
    const matches=(pago.concepto||'').match(/Cuota (\d+)/g)||[];
    for(const m of matches) { const n=parseInt(m.replace('Cuota ','')); await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',['pendiente','',0,pago.alumno_id,n]); }
  }
  await q('DELETE FROM pagos WHERE id=$1',[req.params.id]); res.json({ok:true});
});

app.post('/api/cobro', async (req,res) => {
  const {alumnoId,monto,medio,origen,cuotasSeleccionadas,fechaManual}=req.body;
  const alumno=await q1('SELECT * FROM alumnos WHERE id=$1',[alumnoId]);
  if(!alumno) return res.json({ok:false,error:'Alumno no encontrado'});
  // Usar fecha manual si viene del cliente, si no usar fecha actual
  const fechaBase=fechaManual?new Date(fechaManual+'T12:00:00'):new Date();
  const dia=fechaBase.getDate();
  const fecha=fechaBase.toLocaleDateString('es-AR')+' '+fechaBase.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
  const conceptos=[];

  if(cuotasSeleccionadas&&cuotasSeleccionadas.length>0) {
    // Cobro manual: respetar la selección del usuario pero aplicar saldo extra automáticamente
    let montoRestante = monto;
    for(const numC of cuotasSeleccionadas) {
      const esGratis=numC===10&&await cuota10Gratis(alumnoId,alumno);
      const precio=esGratis?0:getPrecio(alumno,numC,dia);
      conceptos.push(`Cuota ${numC} (${MESES_NOMBRE_ALL[numC-1]} 2026)${esGratis?' (GRATIS)':''}`);
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',['pagada',fecha,precio,alumnoId,numC]);
      montoRestante -= precio;
    }
    // Si sobra saldo, aplicar a siguientes cuotas
    if (montoRestante > 0) {
      const pendientes = await q('SELECT * FROM cuotas WHERE alumno_id=$1 AND estado=$2 ORDER BY numero_cuota',[alumnoId,'pendiente']);
      for (const c of pendientes) {
        if (montoRestante <= 0) break;
        const esGratis = c.numero_cuota===10&&await cuota10Gratis(alumnoId,alumno);
        const precio = esGratis?0:getPrecio(alumno,c.numero_cuota,dia);
        if (precio===0||montoRestante>=precio) {
          await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4',['pagada',fecha,precio,c.id]);
          conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026) [credito]`);
          montoRestante -= precio;
        }
      }
    }
  }
  const r=await q('INSERT INTO pagos (fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[fecha,alumnoId,alumno.nombre,alumno.curso,monto,conceptos.join(', '),medio,origen]);
  res.json({ok:true,pagoId:r[0].id,fecha,conceptos});
});

// Reprocesar pagos históricos con lógica de saldo correcta
app.post('/api/reprocesar-historicos', async (req,res) => {
  const alumnos = await q('SELECT * FROM alumnos ORDER BY id');
  let reprocesados = 0, corregidos = 0;

  for (const alumno of alumnos) {
    // Solo procesar alumnos con pagos importados
    const pagosAlumno = await q(
      "SELECT * FROM pagos WHERE alumno_id=$1 AND (origen LIKE '%Importado%' OR origen LIKE '%Banco%') ORDER BY fecha ASC, id ASC",
      [alumno.id]
    );
    if (!pagosAlumno.length) continue;

    // Obtener cuotas actuales del alumno (1-3)
    const cuotasActuales = await q(
      'SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota<=3 ORDER BY numero_cuota',
      [alumno.id]
    );

    // Calcular total pagado vs total de cuotas marcadas como pagadas
    const totalPagado = pagosAlumno.reduce((s, p) => s + parseFloat(p.monto), 0);
    const cuotasPagadas = cuotasActuales.filter(c => c.estado === 'pagada');

    // Si hay exceso de pago sobre las cuotas marcadas, puede haber cuotas adicionales a cubrir
    let totalCuotasPagadas = 0;
    for (const c of cuotasPagadas) {
      totalCuotasPagadas += parseFloat(c.monto_pagado) || 0;
    }

    const exceso = totalPagado - totalCuotasPagadas;

    if (exceso >= 100) { // Hay exceso significativo
      // Verificar si puede cubrir cuotas pendientes
      const pendientes = await q(
        'SELECT * FROM cuotas WHERE alumno_id=$1 AND estado=$2 AND numero_cuota<=3 ORDER BY numero_cuota',
        [alumno.id, 'pendiente']
      );

      let disponible = exceso;
      for (const c of pendientes) {
        if (disponible <= 0) break;
        const esBonif = MESES_TODO_EL_MES.includes(c.numero_cuota); // Solo meses especiales
        const precio = esBonif ? parseFloat(alumno.precio_bonificado) : parseFloat(alumno.precio_normal);

        // Si el exceso cubre la cuota pendiente, marcarla como pagada
        if (disponible >= precio * 0.9) { // 90% del precio como mínimo
          const ultimoPago = pagosAlumno[pagosAlumno.length - 1];
          await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4',
            ['pagada', ultimoPago.fecha, Math.min(disponible, precio), c.id]);
          disponible -= precio;
          corregidos++;
        }
      }
    }
    reprocesados++;
  }

  res.json({ ok: true, reprocesados, corregidos, mensaje: `${reprocesados} alumnos procesados, ${corregidos} cuotas corregidas por exceso de pago` });
});

// Función central: aplica un monto a cuotas pendientes de más antigua a más nueva
// Si sobra saldo, lo aplica a la siguiente cuota que venza
async function aplicarPagoConSaldo(alumnoId, alumno, monto, fecha, origen) {
  const dia = parseInt((fecha||'').split('/')[0]) || new Date().getDate();
  const pendientes = await q('SELECT * FROM cuotas WHERE alumno_id=$1 AND estado=$2 ORDER BY numero_cuota', [alumnoId, 'pendiente']);
  let restante = monto;
  const conceptos = [];

  for (const c of pendientes) {
    if (restante <= 0) break;
    const esGratis = c.numero_cuota === 10 && await cuota10Gratis(alumnoId, alumno);
    const precio = esGratis ? 0 : getPrecio(alumno, c.numero_cuota, dia);
    if (precio === 0 || restante >= precio) {
      // Pago completo de la cuota
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4', ['pagada', fecha, precio, c.id]);
      conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026)${esGratis?' (GRATIS)':''}`);
      restante -= precio;
    } else if (restante > 0 && restante < precio) {
      // Pago parcial — deja la cuota pendiente con el monto parcial registrado
      const saldoPendiente = precio - restante;
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4', ['pendiente', fecha, restante, c.id]);
      conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026) — pago parcial $${restante.toLocaleString('es-AR')}, saldo pendiente $${saldoPendiente.toLocaleString('es-AR')}`);
      restante = 0;
    }
  }

  // Si sobra saldo, aplicar a la siguiente cuota pendiente (crédito adelantado)
  if (restante > 0) {
    const siguientes = await q('SELECT * FROM cuotas WHERE alumno_id=$1 AND estado=$2 ORDER BY numero_cuota', [alumnoId, 'pendiente']);
    for (const c of siguientes) {
      if (restante <= 0) break;
      const esGratis = c.numero_cuota === 10 && await cuota10Gratis(alumnoId, alumno);
      const precio = esGratis ? 0 : getPrecio(alumno, c.numero_cuota, dia);
      if (precio === 0 || restante >= precio) {
        await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4', ['pagada', fecha, precio, c.id]);
        conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026) [credito]`);
        restante -= precio;
      } else if (restante > 0 && restante < precio) {
        const saldoPendiente = precio - restante;
        await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4', ['pendiente', fecha, restante, c.id]);
        conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026) — pago parcial $${restante.toLocaleString('es-AR')}, saldo pendiente $${saldoPendiente.toLocaleString('es-AR')}`);
        restante = 0;
      }
    }
  }

  return { conceptos, saldoRestante: restante };
}

app.post('/api/banco', async (req,res) => {
  const {filas,colCuit,colMonto}=req.body;
  const alumnos=await q('SELECT * FROM alumnos WHERE activo=TRUE');
  const cuitMap={};
  alumnos.forEach(a=>{
    if(a.cuits) a.cuits.split(',').forEach(c=>{
      const clean=c.trim().replace(/[^0-9]/g,'');
      if(clean.length>=7) cuitMap[clean]=a;
    });
  });
  const dia=new Date().getDate(), fecha=new Date().toLocaleDateString('es-AR');
  let aplicados=0,duplicados=0; const noEncontrados=[],sinCuit=[];
  for(const fila of filas) {
    const cuit=normalizarCuit(fila[colCuit]); const monto=parsearMonto(fila[colMonto]);
    const descrip=fila['DESCRIP']||fila['descrip']||fila['DESCRIPCION']||fila['DETALLE']||'';
    if(!cuit){sinCuit.push({detalle:String(fila[colCuit]||'').slice(0,80),descrip:String(descrip).trim(),monto});continue;}
    if(monto<=0)continue;
    const alumno=cuitMap[cuit];
    if(!alumno){
      let fr=fila['FECHA']||fila['fecha']||fila['Fecha']||'',fs='';
      if(typeof fr==='number'){const d=new Date(Math.round((fr-25569)*86400*1000));fs=d.toLocaleDateString('es-AR');}
      else if(fr instanceof Date){fs=fr.toLocaleDateString('es-AR');}
      else{fs=String(fr).slice(0,10);}
      noEncontrados.push({cuit,monto,fecha:fs,detalle:String(fila[colCuit]||'').slice(0,80),descrip:String(descrip).trim()});
      continue;
    }
    // Anti-duplicado: verificar si ya existe un pago del mismo alumno con el mismo monto
    // independientemente de la fecha o el origen (Excel, banco, manual)
    const yaExiste = await q1(
      "SELECT id, fecha, origen FROM pagos WHERE alumno_id=$1 AND monto=$2",
      [alumno.id, monto]
    );
    if (yaExiste) { duplicados++; continue; }

    // Usar la fecha del archivo bancario, no la de importación
    let fechaPago = fecha;
    const fechaRaw = fila['FECHA'] || fila['fecha'] || fila['Fecha'] || '';
    if (fechaRaw) {
      if (typeof fechaRaw === 'number') {
        const d = new Date(Math.round((fechaRaw - 25569) * 86400 * 1000));
        fechaPago = d.toLocaleDateString('es-AR');
      } else if (fechaRaw instanceof Date) {
        fechaPago = fechaRaw.toLocaleDateString('es-AR');
      } else if (String(fechaRaw).length >= 8) {
        fechaPago = String(fechaRaw).slice(0, 10);
      }
    }

    const {conceptos} = await aplicarPagoConSaldo(alumno.id, alumno, monto, fechaPago, `Banco (CUIT ${cuit})`);
    await q('INSERT INTO pagos (fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [fechaPago,alumno.id,alumno.nombre,alumno.curso,monto,conceptos.join(', ')||'Transferencia bancaria','Transferencia',`Banco (CUIT ${cuit})`]);
    aplicados++;
  }
  res.json({ok:true,aplicados,duplicados,noEncontrados,sinCuit,totalFilas:filas.length});
});

app.post('/api/backfill-pagos', async (req,res) => {
  const cuotas=await q('SELECT c.*,a.nombre,a.curso,a.precio_bonificado FROM cuotas c JOIN alumnos a ON c.alumno_id=a.id WHERE c.estado=$1 ORDER BY c.alumno_id,c.numero_cuota',['pagada']);
  let insertados=0;
  for(const c of cuotas) {
    const existe=await q1('SELECT id FROM pagos WHERE alumno_id=$1 AND concepto LIKE $2',[c.alumno_id,`%Cuota ${c.numero_cuota}%`]);
    if(!existe){
      const fecha=c.fecha_pago||`2026-0${MESES_IDX[c.numero_cuota-1]+1}-01`;
      await q('INSERT INTO pagos (fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[fecha,c.alumno_id,c.nombre,c.curso,parseFloat(c.monto_pagado)||parseFloat(c.precio_bonificado),`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026)`,'Importado','Importado desde planilla']);
      insertados++;
    }
  }
  res.json({ok:true,insertados});
});

app.get('/api/reporte', async (req,res) => {
  const alumnos=await q('SELECT * FROM alumnos WHERE activo=TRUE ORDER BY nombre');
  const mesActual=new Date().getMonth(), dia=new Date().getDate();
  // Cargar TODAS las cuotas y pagos de una sola vez
  const todasCuotas=await q('SELECT * FROM cuotas WHERE alumno_id=ANY($1) ORDER BY numero_cuota',[alumnos.map(a=>a.id)]);
  const todosPagos=await q('SELECT alumno_id,COALESCE(SUM(monto),0) as total FROM pagos WHERE alumno_id=ANY($1) GROUP BY alumno_id',[alumnos.map(a=>a.id)]);
  const mapPagos={};
  todosPagos.forEach(p=>{ mapPagos[p.alumno_id]=parseFloat(p.total||0); });
  const resultado=[];
  for(const a of alumnos) {
    const cuotas=todasCuotas.filter(c=>c.alumno_id===a.id);
    const totalPagado=mapPagos[a.id]||0;
    const estadoCuotas={},fechasPago={},montosPago={};
    for(let i=0;i<10;i++){
      const numC=i+1;
      if(MESES_IDX[i]>mesActual){estadoCuotas[numC]='futura';continue;}
      const cuota=cuotas.find(c=>c.numero_cuota===numC);
      if(!cuota){estadoCuotas[numC]='pendiente';continue;}
      estadoCuotas[numC]=cuota.estado==='pagada'?(cuota.compensada?'compensada':'pagada'):'pendiente';
      if(cuota.fecha_pago&&cuota.fecha_pago!=='')fechasPago[numC]=String(cuota.fecha_pago).slice(0,10);
      if(parseFloat(cuota.monto_pagado)>0)montosPago[numC]=parseFloat(cuota.monto_pagado);
    }
    const c10g=await cuota10Gratis(a.id,a,cuotas);
    if(c10g&&estadoCuotas[10]==='pendiente')estadoCuotas[10]='gratis';
    const cuotasGen=Object.entries(estadoCuotas).filter(([,v])=>v!=='futura');
    const totalDebido=cuotasGen.reduce((s,[k])=>{const n=parseInt(k);return s+(n===10&&c10g?0:getPrecio(a,n,dia));},0);
    let saldo=totalPagado-totalDebido;
    if(saldo>0){let d=saldo;for(let i=0;i<10;i++){const n=i+1;if(estadoCuotas[n]==='pendiente'&&d>0){const p=n===10&&c10g?0:getPrecio(a,n,dia);if(p>0&&d>=p){estadoCuotas[n]='compensada';d-=p;}}}}
    const deudaReal=Object.entries(estadoCuotas).reduce((s,[k,v])=>{if(v!=='pendiente')return s;const n=parseInt(k);const precio=n===10&&c10g?0:getPrecio(a,n,dia);const pagado=montosPago[n]||0;return s+(precio-pagado);},0);
    resultado.push({id:a.id,nombre:a.nombre,curso:a.curso,precio_normal:parseFloat(a.precio_normal),precio_bonificado:parseFloat(a.precio_bonificado),cuits:a.cuits,telefono:a.telefono||'',activo:a.activo,estadoCuotas,fechasPago,montosPago,deudaReal,totalPagado,cuota10Gratis:c10g});
  }
  res.json(resultado);
});

// Corregir fechas de pagos bancarios al valor real del archivo
app.get('/api/corregir-fechas-banco', async (req,res) => {
  const correcciones = [{"id":435,"fecha_real":"2/5/2026"},{"id":431,"fecha_real":"7/5/2026"},{"id":430,"fecha_real":"11/5/2026"},{"id":428,"fecha_real":"11/5/2026"},{"id":426,"fecha_real":"13/5/2026"},{"id":424,"fecha_real":"6/5/2026"},{"id":382,"fecha_real":"11/5/2026"}];
  let corregidos = 0;
  for (const c of correcciones) {
    await q('UPDATE pagos SET fecha=$1 WHERE id=$2', [c.fecha_real, c.id]);
    // También actualizar las cuotas asociadas
    await q('UPDATE cuotas SET fecha_pago=$1 WHERE alumno_id=(SELECT alumno_id FROM pagos WHERE id=$2) AND fecha_pago=(SELECT fecha FROM pagos WHERE id=$2)', [c.fecha_real, c.id]);
    corregidos++;
  }
  res.json({ ok: true, corregidos });
});

// Bonificar cuota
app.post('/api/bonificar', async (req, res) => {
  const { alumnoId, numCuota, monto, motivo } = req.body;
  const alumno = await q1('SELECT * FROM alumnos WHERE id=$1', [alumnoId]);
  if (!alumno) return res.json({ ok: false, error: 'Alumno no encontrado' });
  const fecha = new Date().toLocaleDateString('es-AR');
  await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
    ['pagada', fecha, monto, alumnoId, numCuota]);
  const concepto = `Cuota ${numCuota} (${MESES_NOMBRE_ALL[numCuota-1]} 2026) — Bonificada${motivo ? ': ' + motivo : ''}`;
  await q('INSERT INTO pagos (fecha,alumno_id,alumno_nombre,curso,monto,concepto,medio,origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [fecha, alumnoId, alumno.nombre, alumno.curso, monto, concepto, 'Bonificación', 'Bonificación manual']);
  res.json({ ok: true });
});

app.post('/api/reimputar', async (req,res) => {
  const {alumnoId,cuotaOrigen,cuotaDestino}=req.body;
  const origen=await q1('SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota=$2',[alumnoId,cuotaOrigen]);
  if(!origen||origen.estado!=='pagada') return res.json({ok:false,error:'Cuota origen no está pagada'});
  await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3,compensada=$4 WHERE alumno_id=$5 AND numero_cuota=$6',['pagada',origen.fecha_pago,origen.monto_pagado,origen.compensada,alumnoId,cuotaDestino]);
  await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3,compensada=$4 WHERE alumno_id=$5 AND numero_cuota=$6',['pendiente','',0,false,alumnoId,cuotaOrigen]);
  const pago=await q1('SELECT * FROM pagos WHERE alumno_id=$1 AND concepto LIKE $2 ORDER BY id DESC LIMIT 1',[alumnoId,`%Cuota ${cuotaOrigen}%`]);
  if(pago){await q('UPDATE pagos SET concepto=$1 WHERE id=$2',[pago.concepto.replace(`Cuota ${cuotaOrigen} (${MESES_NOMBRE_ALL[cuotaOrigen-1]} 2026)`,`Cuota ${cuotaDestino} (${MESES_NOMBRE_ALL[cuotaDestino-1]} 2026)`),pago.id]);}
  res.json({ok:true});
});

app.get('/api/aranceles', async (req,res) => { res.json(await q('SELECT * FROM aranceles ORDER BY desde DESC')); });
app.post('/api/aranceles', async (req,res) => {
  const {desde,descripcion}=req.body;
  const r=await q('INSERT INTO aranceles (desde,descripcion,creado) VALUES ($1,$2,$3) RETURNING id',[desde,descripcion||'',new Date().toISOString()]);
  const id=r[0].id;
  const alumnos=await q('SELECT * FROM alumnos WHERE activo=TRUE ORDER BY nombre');
  for(const a of alumnos) await q('INSERT INTO aranceles_precios (arancel_id,alumno_id,precio_normal,precio_bonificado) VALUES ($1,$2,$3,$4)',[id,a.id,a.precio_normal,a.precio_bonificado]);
  // Clonar precios por curso del arancel anterior, o calcular del promedio
  const prevArancel=await q1('SELECT id FROM aranceles WHERE id!=$1 ORDER BY desde DESC LIMIT 1',[id]);
  if(prevArancel) {
    const prevCursos=await q('SELECT * FROM aranceles_cursos WHERE arancel_id=$1',[prevArancel.id]);
    for(const c of prevCursos) await q('INSERT INTO aranceles_cursos (arancel_id,curso,precio_normal,precio_bonificado) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,c.curso,c.precio_normal,c.precio_bonificado]);
  } else {
    const cursos=await q("SELECT DISTINCT curso FROM alumnos WHERE activo=TRUE AND curso!='' ORDER BY curso");
    for(const c of cursos) {
      const precios=await q('SELECT precio_normal,precio_bonificado FROM alumnos WHERE curso=$1 AND activo=TRUE AND (precio_especial=FALSE OR precio_especial IS NULL)',[c.curso]);
      if(!precios.length) continue;
      const pn=Math.round(precios.reduce((s,p)=>s+Number(p.precio_normal),0)/precios.length);
      const pb=Math.round(precios.reduce((s,p)=>s+Number(p.precio_bonificado),0)/precios.length);
      await q('INSERT INTO aranceles_cursos (arancel_id,curso,precio_normal,precio_bonificado) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,c.curso,pn,pb]);
    }
  }
  res.json({ok:true,id});
});
app.get('/api/aranceles/:id/precios', async (req,res) => { res.json(await q('SELECT ap.*,a.nombre,a.curso,a.precio_especial FROM aranceles_precios ap JOIN alumnos a ON ap.alumno_id=a.id WHERE ap.arancel_id=$1 ORDER BY a.curso,a.nombre',[req.params.id])); });
app.put('/api/aranceles/:id/precios', async (req,res) => {
  const {precios}=req.body; const hoy=new Date().toISOString().slice(0,10);
  const arancel=await q1('SELECT * FROM aranceles WHERE id=$1',[req.params.id]);
  for(const p of precios){
    await q('UPDATE aranceles_precios SET precio_normal=$1,precio_bonificado=$2 WHERE arancel_id=$3 AND alumno_id=$4',[p.precio_normal,p.precio_bonificado,req.params.id,p.alumno_id]);
    if(arancel&&arancel.desde<=hoy) await q('UPDATE alumnos SET precio_normal=$1,precio_bonificado=$2 WHERE id=$3',[p.precio_normal,p.precio_bonificado,p.alumno_id]);
  }
  res.json({ok:true});
});
// Precios por curso
app.get('/api/aranceles/:id/cursos', async (req,res) => {
  res.json(await q('SELECT * FROM aranceles_cursos WHERE arancel_id=$1 ORDER BY curso',[req.params.id]));
});
app.put('/api/aranceles/:id/cursos', async (req,res) => {
  const {curso,precio_normal,precio_bonificado,desde_cuota}=req.body;
  const arancel=await q1('SELECT * FROM aranceles WHERE id=$1',[req.params.id]);
  if(!arancel) return res.json({ok:false});
  await q('INSERT INTO aranceles_cursos (arancel_id,curso,precio_normal,precio_bonificado) VALUES ($1,$2,$3,$4) ON CONFLICT (arancel_id,curso) DO UPDATE SET precio_normal=$3,precio_bonificado=$4',[req.params.id,curso,precio_normal,precio_bonificado]);
  const alumnos=await q('SELECT id FROM alumnos WHERE curso=$1 AND activo=TRUE AND (precio_especial=FALSE OR precio_especial IS NULL)',[curso]);
  for(const a of alumnos) {
    await q('UPDATE alumnos SET precio_normal=$1,precio_bonificado=$2 WHERE id=$3',[precio_normal,precio_bonificado,a.id]);
    await q('UPDATE aranceles_precios SET precio_normal=$1,precio_bonificado=$2 WHERE arancel_id=$3 AND alumno_id=$4',[precio_normal,precio_bonificado,req.params.id,a.id]);
    if(desde_cuota && desde_cuota!=='ninguna') {
      const desdeCuota=desde_cuota==='futuras'?(new Date().getMonth()+1):parseInt(desde_cuota);
      await q('UPDATE cuotas SET monto_pagado=$1 WHERE alumno_id=$2 AND estado=$3 AND numero_cuota>=$4',[precio_normal,a.id,'pendiente',desdeCuota]);
    }
  }
  res.json({ok:true,afectados:alumnos.length});
});
// Precio especial por alumno
app.put('/api/alumnos/:id/precio-especial', async (req,res) => {
  const {precio_especial,precio_normal,precio_bonificado}=req.body;
  await q('UPDATE alumnos SET precio_especial=$1,precio_normal=$2,precio_bonificado=$3 WHERE id=$4',[precio_especial,precio_normal,precio_bonificado,req.params.id]);
  res.json({ok:true});
});
app.delete('/api/aranceles/:id', async (req,res) => {
  await q('DELETE FROM aranceles_precios WHERE arancel_id=$1',[req.params.id]);
  await q('DELETE FROM aranceles_cursos WHERE arancel_id=$1',[req.params.id]);
  await q('DELETE FROM aranceles WHERE id=$1',[req.params.id]); res.json({ok:true});
});

app.get('/api/diagnostico/cuotas/:nombre', async (req,res) => {
  const n=decodeURIComponent(req.params.nombre).toUpperCase();
  const alumno=await q1('SELECT * FROM alumnos WHERE nombre LIKE $1',[`%${n}%`]);
  if(!alumno) return res.json({error:'No encontrado'});
  res.json({alumno:alumno.nombre,id:alumno.id,cuotas:await q('SELECT * FROM cuotas WHERE alumno_id=$1 ORDER BY numero_cuota',[alumno.id])});
});

// RESTAURAR cuotas históricas al estado original del Excel
app.get('/api/restaurar-historicos', async (req,res) => {
  const pagosHist = [{id:1,c:[true,true,false]},{id:2,c:[true,true,false]},{id:3,c:[true,true,false]},{id:4,c:[true,false,false]},{id:5,c:[true,true,true]},{id:6,c:[false,false,true]},{id:7,c:[true,true,true]},{id:8,c:[true,true,true]},{id:9,c:[true,true,false]},{id:10,c:[false,false,false]},{id:11,c:[true,true,true]},{id:12,c:[true,true,true]},{id:13,c:[false,true,true]},{id:14,c:[true,true,false]},{id:15,c:[true,true,true]},{id:16,c:[true,true,true]},{id:17,c:[true,true,true]},{id:18,c:[true,true,true]},{id:19,c:[true,true,true]},{id:20,c:[false,true,false]},{id:21,c:[false,false,false]},{id:22,c:[true,true,true]},{id:23,c:[true,true,true]},{id:24,c:[true,true,false]},{id:25,c:[true,true,true]},{id:26,c:[true,false,false]},{id:27,c:[true,true,true]},{id:28,c:[true,true,true]},{id:29,c:[true,true,false]},{id:30,c:[true,true,false]},{id:31,c:[false,false,false]},{id:32,c:[true,true,true]},{id:33,c:[true,true,false]},{id:34,c:[true,true,true]},{id:35,c:[false,true,true]},{id:36,c:[true,true,false]},{id:37,c:[true,true,true]},{id:38,c:[true,true,true]},{id:39,c:[true,true,true]},{id:40,c:[true,true,true]},{id:41,c:[true,true,true]},{id:42,c:[true,true,true]},{id:43,c:[true,true,false]},{id:44,c:[true,true,false]},{id:45,c:[true,true,false]},{id:46,c:[true,true,false]},{id:47,c:[true,true,true]},{id:48,c:[true,true,false]},{id:49,c:[true,true,true]},{id:50,c:[true,true,false]},{id:51,c:[true,true,false]},{id:52,c:[true,true,false]},{id:53,c:[true,true,false]},{id:54,c:[true,true,false]},{id:55,c:[false,true,false]},{id:56,c:[false,false,false]},{id:57,c:[true,true,true]},{id:58,c:[true,true,false]},{id:59,c:[true,true,true]},{id:60,c:[true,true,true]},{id:61,c:[false,true,true]},{id:62,c:[true,true,true]},{id:63,c:[true,true,true]},{id:64,c:[true,true,true]},{id:65,c:[true,true,true]},{id:66,c:[true,true,true]},{id:67,c:[true,true,true]},{id:68,c:[false,true,true]},{id:69,c:[true,true,true]},{id:70,c:[true,true,true]},{id:71,c:[true,true,true]},{id:72,c:[true,true,true]},{id:73,c:[true,true,false]},{id:74,c:[true,true,false]},{id:75,c:[true,true,true]},{id:76,c:[false,false,false]},{id:77,c:[true,true,true]},{id:78,c:[true,true,false]},{id:79,c:[true,true,false]},{id:80,c:[true,true,true]},{id:81,c:[true,true,true]},{id:82,c:[false,false,false]},{id:83,c:[false,false,false]},{id:84,c:[true,true,false]},{id:85,c:[true,true,true]},{id:86,c:[true,true,false]},{id:87,c:[false,true,true]},{id:88,c:[true,true,false]},{id:89,c:[true,true,false]},{id:90,c:[true,true,false]},{id:91,c:[true,true,true]},{id:92,c:[true,true,true]},{id:93,c:[true,true,true]},{id:94,c:[true,true,true]},{id:95,c:[true,true,true]},{id:96,c:[true,true,true]},{id:97,c:[true,true,true]},{id:98,c:[true,true,true]},{id:99,c:[false,false,false]},{id:100,c:[true,true,true]},{id:101,c:[true,true,true]},{id:102,c:[true,true,false]},{id:103,c:[true,false,false]},{id:104,c:[true,true,true]},{id:105,c:[false,true,false]},{id:106,c:[true,true,true]},{id:107,c:[true,true,true]},{id:108,c:[true,true,true]},{id:109,c:[true,true,true]},{id:110,c:[true,true,false]},{id:111,c:[true,true,true]},{id:112,c:[true,false,false]},{id:113,c:[true,true,true]},{id:114,c:[true,true,false]},{id:115,c:[true,true,false]},{id:116,c:[true,true,false]},{id:117,c:[true,true,false]},{id:118,c:[true,false,true]},{id:119,c:[true,true,true]},{id:120,c:[true,true,false]},{id:121,c:[true,true,false]},{id:122,c:[false,false,false]},{id:123,c:[true,true,false]},{id:124,c:[true,true,true]},{id:125,c:[true,true,true]},{id:126,c:[true,true,false]},{id:127,c:[true,true,true]},{id:128,c:[false,true,false]},{id:129,c:[true,true,true]},{id:130,c:[true,true,true]},{id:131,c:[false,true,false]},{id:132,c:[true,true,true]},{id:133,c:[true,true,true]},{id:134,c:[true,true,true]},{id:135,c:[true,true,false]},{id:136,c:[true,true,false]},{id:137,c:[true,true,true]},{id:138,c:[true,true,true]},{id:139,c:[true,true,true]},{id:140,c:[true,true,true]},{id:141,c:[true,false,false]},{id:142,c:[true,true,true]},{id:143,c:[true,true,true]},{id:144,c:[false,true,true]},{id:145,c:[true,true,true]},{id:146,c:[true,true,true]},{id:147,c:[true,true,false]},{id:148,c:[false,true,false]},{id:149,c:[true,true,true]},{id:150,c:[true,true,true]},{id:151,c:[true,true,true]},{id:152,c:[true,true,true]},{id:153,c:[true,true,true]},{id:154,c:[true,true,true]}];

  const FECHAS={"CARABAJAL ANA PAULA":{"1":"2026-03-31","2":"","3":""},"MAURIN GIANA":{"1":"2026-03-10","2":"2026-04-09","3":""},"MARTINEZ CARBAJO IVAN":{"1":"2026-03-12","2":"2026-04-09","3":""},"NIEVA GUEMES MIA ISABELLA":{"1":"2026-03-31","2":"","3":""},"BENICIO BELEN":{"1":"2026-03-21","2":"2026-04-09","3":"2026-05-08"},"CARI, NIRVANA":{"1":"","2":"","3":"2026-05-11"},"DIAZ LOLA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-09"},"NUGHES, LEON":{"1":"2026-03-02","2":"","3":"2026-05-12"},"TRONCOSO ALMA":{"1":"2026-03-26","2":"2026-04-23","3":""},"ALCALA, MATEO":{"1":"","2":"","3":""},"APAZA BORELLI, VERONICA":{"1":"2026-03-04","2":"2026-04-09","3":"2026-05-07"},"GARCIA, NICOLE":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-05"},"GUZMAN, INAKI":{"1":"","2":"2026-04-09","3":"2026-05-10"},"LARA LUCIO":{"1":"2026-04-07","2":"2026-04-07","3":""},"LOPEZ BERRUEZO, PILAR":{"1":"2026-03-12","2":"2026-04-09","3":"2026-05-11"},"RUSSO RADA, FRANCESCA":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-08"},"MORALES BELLIDO ALVARO":{"1":"2026-03-26","2":"2026-05-04","3":"2026-05-04"},"MARTINEZ RUIZ BAUTISTA":{"1":"2026-03-10","2":"2026-05-14","3":"2026-05-14"},"ALTOBELLI, ANA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-06"},"MARTINEZ ARGANARAZ ARIEL":{"1":"","2":"2026-04-13","3":""},"LOPEZ GARCIA VALENTINA":{"1":"","2":"","3":""},"CARDENAS, ARACELI":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-11"},"MORALES, JUANA":{"1":"2026-03-12","2":"2026-04-07","3":"2026-05-05"},"MORALES, LAUTARO":{"1":"2026-03-09","2":"2026-04-06","3":""},"VILLARREAL, MELANIE":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"VERCELLINO IGNACIO":{"1":"2026-04-06","2":"","3":""},"PALACIOS ERNESTINA":{"1":"2026-03-09","2":"2026-03-31","3":"2026-05-05"},"CASAS, GUILLERMINA":{"1":"2026-03-02","2":"2026-04-01","3":"2026-05-01"},"DIAZ TORRES, JOSEFINA":{"1":"2026-03-03","2":"","3":""},"LOPEZ, AGNES":{"1":"2026-03-09","2":"2026-04-30","3":""},"MICOL, FRANCISCO":{"1":"","2":"","3":""},"VITALE GUADALUPE":{"1":"2026-03-09","2":"2026-04-07","3":"2026-05-08"},"CAMACHO AMPARO":{"1":"2026-03-17","2":"2026-04-09","3":""},"CANABIDES, ALLEGRA":{"1":"2026-03-19","2":"2026-04-09","3":"2026-05-11"},"FERNANDEZ AMARELIS":{"1":"","2":"2026-04-15","3":"2026-05-14"},"LUNA, SANTINO":{"1":"2026-03-17","2":"2026-04-09","3":""},"NUNEZ, ALEXANDER":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-05"},"QUIROGA AMPARO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"SOSA, SANTIAGO":{"1":"2026-03-03","2":"2026-04-01","3":"2026-05-05"},"TOLABA CARABAJAL KARLA ARIANA":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-07"},"ZARATE LUCIA":{"1":"2026-03-05","2":"2026-04-09","3":"2026-05-11"},"ALVAREZ LOURDES":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-07"},"CABRERA AMADEO BENICIO":{"1":"2026-04-14","2":"2026-04-16","3":""},"GUANCA PATRICIO MATIAS FEDERICO":{"1":"2026-03-19","2":"2026-04-09","3":""},"CARRASCO, GAEL TIZIANO":{"1":"2026-03-02","2":"2026-04-15","3":""},"FLIA AMADO RUSSO":{"1":"2026-03-02","2":"2026-04-06","3":""},"FLIA BRITO":{"1":"","2":"2026-04-23","3":"2026-05-12"},"FLIA COTINI":{"1":"2026-03-26","2":"2026-04-30","3":""},"FLIA CAYO E Y RAFAELA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-09"},"FLIA CAYO A Y TAIEL":{"1":"2026-03-04","2":"2026-04-01","3":""},"FLIA DIAZ MORALES":{"1":"2026-03-10","2":"2026-04-09","3":""},"FLIA LACURI":{"1":"2026-03-03","2":"2026-04-09","3":""},"FLIA MAMANI RUIZ":{"1":"2026-03-04","2":"2026-03-30","3":""},"FLIA MARTINEZ":{"1":"2026-04-06","2":"2026-04-06","3":""},"FLIA MOYA":{"1":"","2":"2026-04-19","3":""},"FLIA ORTEGA":{"1":"","2":"","3":""},"FLIA RAMIREZ ORTUNO":{"1":"2026-03-12","2":"2026-04-09","3":"2026-05-11"},"FLIA RIVERO":{"1":"2026-03-05","2":"2026-04-08","3":""},"FLIA ROSAS":{"1":"2026-03-05","2":"2026-04-07","3":"2026-05-03"},"FLIA RUANO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-06"},"FLIA OLIVEIRA BEJARANO":{"1":"","2":"2026-04-07","3":"2026-05-11"},"FLIA SANTAFE":{"1":"2026-03-03","2":"2026-04-09","3":"2026-05-06"},"FLIA GITIAN":{"1":"2026-04-07","2":"2026-04-07","3":"2026-05-11"},"FLIA SARAVIA":{"1":"2026-03-31","2":"2026-04-10","3":"2026-05-04"},"FLIA SUAREZ":{"1":"2026-03-11","2":"2026-04-09","3":"2026-05-11"},"FLIA TACTAGI":{"1":"2026-03-05","2":"2026-04-06","3":"2026-05-06"},"FLIA TEJERINA":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-10"},"FLIA TOLABA":{"1":"","2":"2026-04-09","3":"2026-05-11"},"FLIA VACA MONASTEROLO":{"1":"2026-03-05","2":"2026-04-08","3":"2026-05-05"},"FLIA VERCELLINO R":{"1":"2026-03-04","2":"2026-04-04","3":"2026-05-02"},"FLIA VILLAFANE GUITIAN":{"1":"2026-03-08","2":"2026-04-07","3":"2026-05-08"},"FLIA LIENDRO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"FLIA CARI":{"1":"2026-03-09","2":"2026-04-01","3":""},"FLIA RIOS":{"1":"2026-03-09","2":"2026-04-07","3":""},"FLIA MARTINEZ ISAIAS TOBIAS":{"1":"2026-03-10","2":"2026-04-08","3":"2026-05-11"},"FLIA GASPAR GUITIAN":{"1":"","2":"","3":""},"FLIA FECCIA":{"1":"2026-03-31","2":"2026-04-08","3":"2026-05-11"},"FLIA RIOS THIAGO RUTH":{"1":"2026-03-31","2":"2026-04-13","3":""},"FLIA CASIMIRO":{"1":"2026-03-13","2":"2026-04-20","3":""},"ANTUNA MAITENA":{"1":"2026-03-05","2":"2026-04-05","3":"2026-05-04"},"CABRAL SIMON":{"1":"2026-03-03","2":"2026-04-09","3":"2026-05-06"},"CARDENAS, MAILEN":{"1":"","2":"","3":""},"CRUZ, LUDMILA":{"1":"","2":"","3":""},"GUANCA, YAHIR":{"1":"2026-03-09","2":"2026-04-09","3":""},"SORIA LIENDRO, LIA":{"1":"2026-03-10","2":"2026-05-13","3":"2026-05-13"},"CRUZ, EMA ISABELLA":{"1":"2026-05-11","2":"2026-05-11","3":""},"ROJAS, JAZMIN":{"1":"","2":"2026-04-09","3":"2026-05-08"},"REALES, LAUTARO":{"1":"","2":"2026-04-27","3":""},"SEGURA, VICTORIA":{"1":"2026-03-09","2":"2026-04-08","3":""},"SOTILLO CATALINA":{"1":"2026-03-15","2":"2026-04-09","3":""},"YAPURA, BAUTISTA":{"1":"2026-03-06","2":"2026-04-09","3":"2026-05-04"},"ROBLEDO MAXIMO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-10"},"LAIME, DAIANA":{"1":"2026-03-04","2":"2026-04-08","3":"2026-05-04"},"ORELLANA, ORIANA":{"1":"2026-03-20","2":"2026-04-07","3":"2026-05-08"},"RICCO, TIZIANO":{"1":"2026-03-04","2":"2026-04-07","3":"2026-05-06"},"RODRIGUEZ, GENESIS":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-04"},"TOLABA, JEREMIAS":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"ALCALA BAUTISTA":{"1":"2026-03-06","2":"2026-04-07","3":"2026-05-07"},"MOLINA GUADALUPE":{"1":"","2":"","3":""},"CARRASCO, MATEO":{"1":"2026-03-04","2":"2026-04-01","3":"2026-05-05"},"CESPEDES PUPPI, JUAN EMILIO":{"1":"2026-03-03","2":"2026-04-08","3":"2026-05-05"},"CHOQUE JESUS GABRIEL":{"1":"2026-03-10","2":"2026-04-16","3":""},"GARCIA CARBAJAL, VALENTINO GABRIEL":{"1":"2026-03-31","2":"","3":""},"FLORES LUCAS":{"1":"2026-03-09","2":"2026-04-13","3":"2026-04-13"},"GERON CARMEN":{"1":"","2":"2026-04-14","3":""},"GUTIERREZ, EMMA":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-07"},"MONTES, LOLA":{"1":"2026-03-10","2":"2026-04-08","3":"2026-05-06"},"PARRILLA, VALENTINA":{"1":"2026-03-05","2":"2026-04-09","3":"2026-05-14"},"POSADAS, JEREMIAS":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"RIVERO, AGUSTIN":{"1":"2026-03-05","2":"2026-04-07","3":""},"SANGUEZO MIRANDA, LUZ":{"1":"2026-03-31","2":"2026-04-08","3":"2026-05-12"},"TERCERO, MATEO":{"1":"2026-04-06","2":"","3":""},"VEDIA, FELIPE":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-04"},"VELA, NAHIARA":{"1":"2026-03-09","2":"2026-04-09","3":""},"ZARATE FRANCESCA":{"1":"2026-04-09","2":"2026-04-09","3":""},"NERI SALVADOR":{"1":"2026-04-09","2":"2026-04-09","3":""},"CARMEN GUILLERMINA":{"1":"2026-04-09","2":"2026-04-09","3":""},"ABALOS, AYLEN":{"1":"2026-03-09","2":"","3":"2026-05-11"},"ACOSTA MIA":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-07"},"AGUILERA, MIA":{"1":"2026-03-02","2":"2026-04-01","3":""},"ANTONELLI, DONATO":{"1":"2026-03-10","2":"2026-04-09","3":""},"CAMPOS GIOVANI":{"1":"","2":"","3":""},"CASTRO, AGUSTIN":{"1":"2026-03-05","2":"2026-04-28","3":""},"GOMEZ, NAZARENO":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-04"},"GUTIERREZ, ZOEMI":{"1":"2026-03-10","2":"2026-04-10","3":"2026-05-10"},"PERALES, MARIA CECILIA":{"1":"2026-03-02","2":"2026-04-09","3":""},"PERCINO, NAHIARA":{"1":"2026-03-17","2":"2026-04-16","3":"2026-05-14"},"TOLABA, ESTEFANIA":{"1":"","2":"2026-04-27","3":""},"TOMASINI AGUSTIN":{"1":"2026-03-03","2":"2026-04-07","3":"2026-05-05"},"YURKINA, MISAEL":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"VARGAS THIAGO":{"1":"","2":"2026-04-09","3":""},"TAGLIOLI ANA":{"1":"2026-03-30","2":"2026-04-08","3":"2026-05-06"},"VILCA ESPERANZA":{"1":"2026-03-17","2":"2026-04-08","3":"2026-05-06"},"FACCHIN, OLIVIA":{"1":"2026-03-09","2":"2026-04-09","3":"2026-05-11"},"LOPEZ ESTEFANIA":{"1":"2026-04-09","2":"2026-04-09","3":""},"MANSILLA, ABRIL":{"1":"2026-03-10","2":"2026-03-31","3":""},"MONDAQUE SABRINA":{"1":"2026-03-09","2":"2026-04-08","3":"2026-05-06"},"REMENTERIA ISABEL":{"1":"2026-03-31","2":"2026-04-09","3":"2026-05-07"},"MOSA, TADEO":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-05"},"OROZCO, LAUTARO":{"1":"2026-03-06","2":"2026-04-07","3":"2026-05-07"},"ORTEGA MARCOS":{"1":"2026-04-20","2":"","3":""},"VILLANUEVA CARLOS":{"1":"2026-03-04","2":"2026-04-07","3":"2026-05-05"},"GUAYMAS ZERPA, CIRO":{"1":"2026-03-06","2":"2026-04-09","3":"2026-05-11"},"CABELLO ALMA":{"1":"","2":"2026-04-09","3":"2026-05-09"},"FIRME TIZIANO":{"1":"2026-03-30","2":"2026-04-09","3":"2026-05-04"},"CHAVEZ DI PAULI CATALINA":{"1":"2026-03-03","2":"2026-04-06","3":"2026-05-08"},"MAMANI, FELICITAS":{"1":"2026-03-19","2":"2026-04-20","3":""},"ALANCAY DEMIR":{"1":"","2":"2026-04-09","3":""},"RAMPULLA, GINO":{"1":"2026-03-09","2":"2026-04-06","3":"2026-05-08"},"ZERPA, MATHEO":{"1":"2026-03-10","2":"2026-04-07","3":"2026-05-07"},"APARICIO ROYANO NAHYARA":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-11"},"VILTE PAZ LORENA SOL":{"1":"2026-03-10","2":"2026-04-09","3":"2026-05-05"},"CORONEL LAUTARO":{"1":"2026-03-26","2":"2026-04-09","3":"2026-05-06"},"VILLANUEVA FRANCISCO":{"1":"2026-04-13","2":"2026-04-09","3":"2026-05-11"}};
  const MONTOS={"CARABAJAL ANA PAULA":{"1":73000,"2":0,"3":0},"MAURIN GIANA":{"1":73000,"2":73000,"3":0},"MARTINEZ CARBAJO IVAN":{"1":73000,"2":73000,"3":0},"NIEVA GUEMES MIA ISABELLA":{"1":73000,"2":0,"3":0},"BENICIO BELEN":{"1":73000,"2":73000,"3":73000},"CARI, NIRVANA":{"1":0,"2":0,"3":52500},"DIAZ LOLA":{"1":52500,"2":52500,"3":52500},"NUGHES, LEON":{"1":52500,"2":52500,"3":52500},"TRONCOSO ALMA":{"1":52500,"2":55000,"3":0},"ALCALA, MATEO":{"1":0,"2":0,"3":0},"APAZA BORELLI, VERONICA":{"1":81500,"2":81500,"3":81500},"GARCIA, NICOLE":{"1":81500,"2":81500,"3":81500},"GUZMAN, INAKI":{"1":0,"2":81500,"3":81500},"LARA LUCIO":{"1":85500,"2":81500,"3":0},"LOPEZ BERRUEZO, PILAR":{"1":81500,"2":81500,"3":81500},"RUSSO RADA, FRANCESCA":{"1":81500,"2":81500,"3":81500},"MORALES BELLIDO ALVARO":{"1":81500,"2":81500,"3":4000},"MARTINEZ RUIZ BAUTISTA":{"1":81500,"2":81500,"3":81500},"ALTOBELLI, ANA":{"1":81500,"2":81500,"3":81500},"MARTINEZ ARGANARAZ ARIEL":{"1":0,"2":171000,"3":0},"LOPEZ GARCIA VALENTINA":{"1":0,"2":0,"3":0},"CARDENAS, ARACELI":{"1":81500,"2":81500,"3":81500},"MORALES, JUANA":{"1":85500,"2":81500,"3":81500},"MORALES, LAUTARO":{"1":73000,"2":73000,"3":0},"VILLARREAL, MELANIE":{"1":81500,"2":81500,"3":81500},"VERCELLINO IGNACIO":{"1":85500,"2":0,"3":0},"PALACIOS ERNESTINA":{"1":81500,"2":81500,"3":81500},"CASAS, GUILLERMINA":{"1":82500,"2":82500,"3":82500},"DIAZ TORRES, JOSEFINA":{"1":82500,"2":82500,"3":0},"LOPEZ, AGNES":{"1":82500,"2":82500,"3":0},"MICOL, FRANCISCO":{"1":0,"2":0,"3":0},"VITALE GUADALUPE":{"1":133000,"2":82500,"3":82500},"CAMACHO AMPARO":{"1":40500,"2":40500,"3":0},"CANABIDES, ALLEGRA":{"1":40500,"2":40500,"3":40500},"FERNANDEZ AMARELIS":{"1":0,"2":42500,"3":42500},"LUNA, SANTINO":{"1":40500,"2":40500,"3":0},"NUNEZ, ALEXANDER":{"1":40500,"2":40500,"3":40500},"QUIROGA AMPARO":{"1":40500,"2":40500,"3":40500},"SOSA, SANTIAGO":{"1":40500,"2":40500,"3":40500},"TOLABA CARABAJAL KARLA ARIANA":{"1":40500,"2":40500,"3":40500},"ZARATE LUCIA":{"1":40500,"2":40500,"3":40000},"ALVAREZ LOURDES":{"1":40500,"2":40500,"3":40500},"CABRERA AMADEO BENICIO":{"1":42500,"2":42500,"3":0},"GUANCA PATRICIO MATIAS FEDERICO":{"1":40500,"2":40500,"3":0},"CARRASCO, GAEL TIZIANO":{"1":40500,"2":42500,"3":0},"FLIA AMADO RUSSO":{"1":155500,"2":155500,"3":0},"FLIA BRITO":{"1":132500,"2":144500,"3":132500},"FLIA COTINI":{"1":100000,"2":100000,"3":0},"FLIA CAYO E Y RAFAELA":{"1":101500,"2":101500,"3":101500},"FLIA CAYO A Y TAIEL":{"1":133000,"2":267000,"3":0},"FLIA DIAZ MORALES":{"1":95000,"2":95000,"3":0},"FLIA LACURI":{"1":87000,"2":87000,"3":0},"FLIA MAMANI RUIZ":{"1":156500,"2":156500,"3":0},"FLIA MARTINEZ":{"1":82000,"2":75500,"3":0},"FLIA MOYA":{"1":0,"2":144500,"3":0},"FLIA ORTEGA":{"1":0,"2":0,"3":0},"FLIA RAMIREZ ORTUNO":{"1":92500,"2":92500,"3":92500},"FLIA RIVERO":{"1":132500,"2":132500,"3":0},"FLIA ROSAS":{"1":170500,"2":170500,"3":170500},"FLIA RUANO":{"1":89000,"2":89000,"3":89000},"FLIA OLIVEIRA BEJARANO":{"1":0,"2":118500,"3":119000},"FLIA SANTAFE":{"1":101500,"2":101500,"3":101500},"FLIA GITIAN":{"1":87000,"2":261000,"3":128000},"FLIA SARAVIA":{"1":127000,"2":127000,"3":127000},"FLIA SUAREZ":{"1":87000,"2":87000,"3":87000},"FLIA TACTAGI":{"1":132500,"2":132500,"3":132500},"FLIA TEJERINA":{"1":133000,"2":133000,"3":133000},"FLIA TOLABA":{"1":0,"2":202000,"3":106000},"FLIA VACA MONASTEROLO":{"1":156000,"2":156000,"3":156000},"FLIA VERCELLINO R":{"1":87000,"2":87000,"3":89000},"FLIA VILLAFANE GUITIAN":{"1":101500,"2":101500,"3":101500},"FLIA LIENDRO":{"1":167500,"2":167500,"3":167500},"FLIA CARI":{"1":101200,"2":97000,"3":0},"FLIA RIOS":{"1":132500,"2":132500,"3":0},"FLIA MARTINEZ ISAIAS TOBIAS":{"1":52500,"2":52500,"3":52500},"FLIA GASPAR GUITIAN":{"1":0,"2":0,"3":0},"FLIA FECCIA":{"1":91500,"2":91500,"3":91500},"FLIA RIOS THIAGO RUTH":{"1":154000,"2":138500,"3":0},"FLIA CASIMIRO":{"1":118000,"2":129000,"3":0},"ANTUNA MAITENA":{"1":56000,"2":50000,"3":50000},"CABRAL SIMON":{"1":56000,"2":56000,"3":56000},"CARDENAS, MAILEN":{"1":0,"2":0,"3":0},"CRUZ, LUDMILA":{"1":0,"2":0,"3":0},"GUANCA, YAHIR":{"1":56000,"2":56000,"3":0},"SORIA LIENDRO, LIA":{"1":56000,"2":56000,"3":56000},"CRUZ, EMA ISABELLA":{"1":56000,"2":5950,"3":0},"ROJAS, JAZMIN":{"1":0,"2":56000,"3":56000},"REALES, LAUTARO":{"1":59000,"2":59000,"3":0},"SEGURA, VICTORIA":{"1":56000,"2":56000,"3":0},"SOTILLO CATALINA":{"1":59000,"2":56000,"3":0},"YAPURA, BAUTISTA":{"1":56000,"2":50000,"3":50000},"ROBLEDO MAXIMO":{"1":56000,"2":56000,"3":56000},"LAIME, DAIANA":{"1":56000,"2":56000,"3":112000},"ORELLANA, ORIANA":{"1":56000,"2":56000,"3":56000},"RICCO, TIZIANO":{"1":56000,"2":56000,"3":112000},"RODRIGUEZ, GENESIS":{"1":56000,"2":56000,"3":56000},"TOLABA, JEREMIAS":{"1":56000,"2":56000,"3":56000},"ALCALA BAUTISTA":{"1":56000,"2":56000,"3":56000},"MOLINA GUADALUPE":{"1":0,"2":0,"3":0},"CARRASCO, MATEO":{"1":45500,"2":45500,"3":45500},"CESPEDES PUPPI, JUAN EMILIO":{"1":45500,"2":45500,"3":45500},"CHOQUE JESUS GABRIEL":{"1":45500,"2":48000,"3":0},"GARCIA CARBAJAL, VALENTINO GABRIEL":{"1":45500,"2":0,"3":0},"FLORES LUCAS":{"1":45500,"2":48000,"3":45500},"GERON CARMEN":{"1":0,"2":96000,"3":0},"GUTIERREZ, EMMA":{"1":45500,"2":45500,"3":45500},"MONTES, LOLA":{"1":45500,"2":45500,"3":45000},"PARRILLA, VALENTINA":{"1":45500,"2":45500,"3":45500},"POSADAS, JEREMIAS":{"1":45500,"2":45500,"3":45500},"RIVERO, AGUSTIN":{"1":45500,"2":45500,"3":0},"SANGUEZO MIRANDA, LUZ":{"1":45500,"2":91000,"3":45500},"TERCERO, MATEO":{"1":48000,"2":0,"3":0},"VEDIA, FELIPE":{"1":45500,"2":45500,"3":45500},"VELA, NAHIARA":{"1":45500,"2":45500,"3":0},"ZARATE FRANCESCA":{"1":45500,"2":45500,"3":0},"NERI SALVADOR":{"1":45500,"2":45500,"3":0},"CARMEN GUILLERMINA":{"1":48000,"2":45500,"3":0},"ABALOS, AYLEN":{"1":50500,"2":0,"3":50500},"ACOSTA MIA":{"1":50500,"2":50500,"3":50500},"AGUILERA, MIA":{"1":50500,"2":50500,"3":0},"ANTONELLI, DONATO":{"1":50500,"2":50500,"3":0},"CAMPOS GIOVANI":{"1":0,"2":0,"3":0},"CASTRO, AGUSTIN":{"1":50500,"2":50500,"3":0},"GOMEZ, NAZARENO":{"1":50500,"2":50500,"3":50500},"GUTIERREZ, ZOEMI":{"1":45500,"2":45000,"3":45000},"PERALES, MARIA CECILIA":{"1":50500,"2":50500,"3":0},"PERCINO, NAHIARA":{"1":50500,"2":53000,"3":50500},"TOLABA, ESTEFANIA":{"1":0,"2":53000,"3":0},"TOMASINI AGUSTIN":{"1":50500,"2":50500,"3":50500},"YURKINA, MISAEL":{"1":45000,"2":45500,"3":45500},"VARGAS THIAGO":{"1":0,"2":50500,"3":0},"TAGLIOLI ANA":{"1":53000,"2":50500,"3":50500},"VILCA ESPERANZA":{"1":50500,"2":50500,"3":50500},"FACCHIN, OLIVIA":{"1":50500,"2":50500,"3":50500},"LOPEZ ESTEFANIA":{"1":111000,"2":90000,"3":0},"MANSILLA, ABRIL":{"1":50500,"2":50500,"3":0},"MONDAQUE SABRINA":{"1":50500,"2":50500,"3":50500},"REMENTERIA ISABEL":{"1":93000,"2":50500,"3":50500},"MOSA, TADEO":{"1":50500,"2":50500,"3":50500},"OROZCO, LAUTARO":{"1":50500,"2":50500,"3":50500},"ORTEGA MARCOS":{"1":53000,"2":0,"3":0},"VILLANUEVA CARLOS":{"1":50500,"2":50500,"3":50500},"GUAYMAS ZERPA, CIRO":{"1":45000,"2":45000,"3":45000},"CABELLO ALMA":{"1":0,"2":50500,"3":53000},"FIRME TIZIANO":{"1":53000,"2":50500,"3":50500},"CHAVEZ DI PAULI CATALINA":{"1":29000,"2":27500,"3":27500},"MAMANI, FELICITAS":{"1":27500,"2":29000,"3":0},"ALANCAY DEMIR":{"1":0,"2":27500,"3":0},"RAMPULLA, GINO":{"1":27500,"2":27500,"3":27500},"ZERPA, MATHEO":{"1":24700,"2":24700,"3":24700},"APARICIO ROYANO NAHYARA":{"1":27500,"2":27500,"3":27500},"VILTE PAZ LORENA SOL":{"1":27500,"2":27500,"3":27500},"CORONEL LAUTARO":{"1":29000,"2":27500,"3":27500},"VILLANUEVA FRANCISCO":{"1":29000,"2":25000,"3":27500}};

  const alumnos = await q('SELECT id,nombre FROM alumnos ORDER BY id');
  let restaurados = 0;
  for (let i = 0; i < pagosHist.length; i++) {
    const p = pagosHist[i];
    const alumno = alumnos[i];
    if (!alumno) continue;
    const nombre = alumno.nombre;
    const fa = FECHAS[nombre]||{};
    const ma = MONTOS[nombre]||{};
    for (let n = 1; n <= 3; n++) {
      const pagado = p.c[n-1];
      const fp = fa[String(n)]||'';
      const mp = ma[String(n)]||0;
      const estado = pagado ? 'pagada' : 'pendiente';
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
        [estado, pagado ? fp : '', pagado ? mp : 0, alumno.id, n]);
    }
    restaurados++;
  }
  res.json({ ok: true, restaurados, mensaje: `${restaurados} alumnos restaurados al estado original del Excel` });
});

// Eliminar pagos duplicados (mismo alumno_id + monto + fecha + origen)
app.get('/api/limpiar-duplicados', async (req,res) => {
  // Encontrar duplicados
  const duplicados = await q(`
    SELECT MIN(id) as id_keep, alumno_id, monto, fecha, origen, COUNT(*) as cnt
    FROM pagos
    GROUP BY alumno_id, monto, fecha, origen
    HAVING COUNT(*) > 1
  `);

  let eliminados = 0;
  for (const d of duplicados) {
    // Eliminar todos menos el primero
    const resultado = await q(
      'DELETE FROM pagos WHERE alumno_id=$1 AND monto=$2 AND fecha=$3 AND origen=$4 AND id != $5',
      [d.alumno_id, d.monto, d.fecha, d.origen, d.id_keep]
    );
    eliminados += (parseInt(d.cnt) - 1);
  }

  res.json({ ok: true, duplicadosEncontrados: duplicados.length, eliminados });
});

// Ver pagos por fecha para diagnóstico
app.get('/api/diagnostico/pagos-fecha/:fecha', async (req,res) => {
  const pagos = await q(
    'SELECT p.*,a.nombre FROM pagos p JOIN alumnos a ON p.alumno_id=a.id WHERE p.fecha LIKE $1 ORDER BY a.nombre',
    [`%${req.params.fecha}%`]
  );
  res.json({ total: pagos.length, pagos });
});

// Ver todos los pagos bancarios recientes
app.get('/api/diagnostico/pagos-banco-recientes', async (req,res) => {
  const pagos = await q(`
    SELECT p.id, p.fecha, p.monto, p.concepto, p.origen, a.nombre, a.curso
    FROM pagos p JOIN alumnos a ON p.alumno_id = a.id
    WHERE p.origen LIKE '%Banco%'
    ORDER BY p.fecha DESC, p.id DESC
    LIMIT 100
  `);
  res.json({ total: pagos.length, pagos });
});

// Eliminar TODOS los pagos bancarios de una fecha específica
app.delete('/api/pagos-banco-fecha/:fecha', async (req,res) => {
  const fecha = decodeURIComponent(req.params.fecha);
  // Primero revertir cuotas asociadas
  const pagos = await q("SELECT * FROM pagos WHERE origen LIKE '%Banco%' AND fecha=$1", [fecha]);
  for (const pago of pagos) {
    const matches = (pago.concepto||'').match(/Cuota (\d+)/g)||[];
    for (const m of matches) {
      const n = parseInt(m.replace('Cuota ',''));
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5 AND fecha_pago=$6',
        ['pendiente','',0,pago.alumno_id,n,fecha]);
    }
  }
  const r = await q("DELETE FROM pagos WHERE origen LIKE '%Banco%' AND fecha=$1", [fecha]);
  res.json({ ok: true, eliminados: pagos.length, fecha });
});

// Eliminar pagos bancarios del 20/5/2026 (duplicados) y revertir cuotas
app.get('/api/limpiar-banco-20mayo', async (req,res) => {
  const fecha = '20/5/2026';
  const pagos = await q("SELECT * FROM pagos WHERE origen LIKE '%Banco%' AND fecha=$1", [fecha]);

  let cuotasRevertidas = 0;
  for (const pago of pagos) {
    // Revertir cuotas que fueron marcadas por este pago específico
    // Solo revertir si la fecha_pago coincide con 20/5/2026
    const matches = (pago.concepto||'').match(/Cuota (\d+)/g)||[];
    for (const m of matches) {
      const n = parseInt(m.replace('Cuota ',''));
      const cuota = await q1('SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota=$2', [pago.alumno_id, n]);
      if (cuota && cuota.fecha_pago === fecha) {
        await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
          ['pendiente','',0,pago.alumno_id,n]);
        cuotasRevertidas++;
      }
    }
  }

  await q("DELETE FROM pagos WHERE origen LIKE '%Banco%' AND fecha=$1", [fecha]);

  res.json({ ok: true, pagosEliminados: pagos.length, cuotasRevertidas });
});

// Limpiar pagos bancarios que duplican pagos ya existentes (del Excel u otro origen)
app.get('/api/limpiar-duplicados-banco', async (req,res) => {
  // Buscar pagos bancarios que tengan el mismo alumno_id y monto que otro pago previo
  const bancarios = await q(
    "SELECT * FROM pagos WHERE origen LIKE '%Banco%' ORDER BY id ASC"
  );

  let eliminados = 0;
  let cuotasRevertidas = 0;

  for (const pago of bancarios) {
    // Buscar si existe otro pago del mismo alumno con el mismo monto pero diferente id
    const previo = await q1(
      "SELECT id FROM pagos WHERE alumno_id=$1 AND monto=$2 AND id != $3",
      [pago.alumno_id, pago.monto, pago.id]
    );

    if (previo) {
      // Es un duplicado — revertir cuotas si las marcó
      const matches = (pago.concepto||'').match(/Cuota (\d+)/g)||[];
      for (const m of matches) {
        const n = parseInt(m.replace('Cuota ',''));
        const cuota = await q1(
          'SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota=$2',
          [pago.alumno_id, n]
        );
        // Solo revertir si la fecha_pago de la cuota coincide con la fecha del pago bancario duplicado
        if (cuota && cuota.fecha_pago === pago.fecha) {
          // Restaurar con datos del pago previo si corresponde
          await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
            ['pendiente','',0,pago.alumno_id,n]);
          cuotasRevertidas++;
        }
      }
      await q('DELETE FROM pagos WHERE id=$1', [pago.id]);
      eliminados++;
    }
  }

  res.json({ ok: true, bancariosProcesados: bancarios.length, eliminados, cuotasRevertidas });
});

// Corregir cuotas marcadas como pagadas con monto 0 → pendiente
app.get('/api/corregir-cuotas-cero', async (req,res) => {
  const cuotasCero = await q(
    "SELECT c.*, a.nombre FROM cuotas c JOIN alumnos a ON c.alumno_id=a.id WHERE c.estado='pagada' AND (c.monto_pagado=0 OR c.monto_pagado IS NULL)"
  );

  let corregidas = 0;
  for (const c of cuotasCero) {
    // Marcar como pendiente
    await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4',
      ['pendiente','',0,c.id]);
    // Eliminar el pago asociado si existe con monto 0
    await q("DELETE FROM pagos WHERE alumno_id=$1 AND monto=0 AND concepto LIKE $2",
      [c.alumno_id, `%Cuota ${c.numero_cuota}%`]);
    corregidas++;
  }

  res.json({ ok: true, corregidas, detalle: cuotasCero.map(c=>({nombre:c.nombre, cuota:c.numero_cuota})) });
});

// Restaurar estado correcto de cuotas 1-3 según el Excel original
// Solo pone como pendiente las que tienen monto=0, sin tocar las que están bien
app.get('/api/corregir-estados-excel', async (req,res) => {
  const ESTADOS_EXCEL = [{"nombre":"CARABAJAL ANA PAULA","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"CARABAJAL ANA PAULA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARABAJAL ANA PAULA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MAURIN GIANA","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MAURIN GIANA","cuota":2,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MAURIN GIANA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MARTINEZ CARBAJO IVAN","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MARTINEZ CARBAJO IVAN","cuota":2,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MARTINEZ CARBAJO IVAN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"NIEVA GUEMES MIA ISABELLA","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"NIEVA GUEMES MIA ISABELLA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"NIEVA GUEMES MIA ISABELLA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"BENICIO BELEN","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"BENICIO BELEN","cuota":2,"estado_correcto":"pagada","monto":73000.0},{"nombre":"BENICIO BELEN","cuota":3,"estado_correcto":"pagada","monto":73000.0},{"nombre":"CARI, NIRVANA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARI, NIRVANA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARI, NIRVANA","cuota":3,"estado_correcto":"pagada","monto":52500.0},{"nombre":"DIAZ LOLA","cuota":1,"estado_correcto":"pagada","monto":52500.0},{"nombre":"DIAZ LOLA","cuota":2,"estado_correcto":"pagada","monto":52500.0},{"nombre":"DIAZ LOLA","cuota":3,"estado_correcto":"pagada","monto":52500.0},{"nombre":"NUGHES, LEON","cuota":1,"estado_correcto":"pagada","monto":52500.0},{"nombre":"NUGHES, LEON","cuota":2,"estado_correcto":"pagada","monto":52500.0},{"nombre":"NUGHES, LEON","cuota":3,"estado_correcto":"pagada","monto":52500.0},{"nombre":"TRONCOSO ALMA","cuota":1,"estado_correcto":"pagada","monto":52500.0},{"nombre":"TRONCOSO ALMA","cuota":2,"estado_correcto":"pagada","monto":55000.0},{"nombre":"TRONCOSO ALMA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ALCALA, MATEO","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ALCALA, MATEO","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ALCALA, MATEO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"APAZA BORELLI, VERONICA","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"APAZA BORELLI, VERONICA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"APAZA BORELLI, VERONICA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"GARCIA, NICOLE","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"GARCIA, NICOLE","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"GARCIA, NICOLE","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"GUZMAN, INAKI","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GUZMAN, INAKI","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"GUZMAN, INAKI","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"LARA LUCIO","cuota":1,"estado_correcto":"pagada","monto":85500.0},{"nombre":"LARA LUCIO","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"LARA LUCIO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"LOPEZ BERRUEZO, PILAR","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"LOPEZ BERRUEZO, PILAR","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"LOPEZ BERRUEZO, PILAR","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"RUSSO RADA, FRANCESCA","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"RUSSO RADA, FRANCESCA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"RUSSO RADA, FRANCESCA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES BELLIDO ALVARO","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES BELLIDO ALVARO","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES BELLIDO ALVARO","cuota":3,"estado_correcto":"pagada","monto":4000.0},{"nombre":"MARTINEZ RUIZ BAUTISTA","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MARTINEZ RUIZ BAUTISTA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MARTINEZ RUIZ BAUTISTA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"ALTOBELLI, ANA","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"ALTOBELLI, ANA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"ALTOBELLI, ANA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MARTINEZ ARGANARAZ ARIEL","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MARTINEZ ARGANARAZ ARIEL","cuota":2,"estado_correcto":"pagada","monto":171000.0},{"nombre":"MARTINEZ ARGANARAZ ARIEL","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"LOPEZ GARCIA VALENTINA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"LOPEZ GARCIA VALENTINA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"LOPEZ GARCIA VALENTINA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARDENAS, ARACELI","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"CARDENAS, ARACELI","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"CARDENAS, ARACELI","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES, JUANA","cuota":1,"estado_correcto":"pagada","monto":85500.0},{"nombre":"MORALES, JUANA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES, JUANA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"MORALES, LAUTARO","cuota":1,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MORALES, LAUTARO","cuota":2,"estado_correcto":"pagada","monto":73000.0},{"nombre":"MORALES, LAUTARO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VILLARREAL, MELANIE","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"VILLARREAL, MELANIE","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"VILLARREAL, MELANIE","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"VERCELLINO IGNACIO","cuota":1,"estado_correcto":"pagada","monto":85500.0},{"nombre":"VERCELLINO IGNACIO","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VERCELLINO IGNACIO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"PALACIOS ERNESTINA","cuota":1,"estado_correcto":"pagada","monto":81500.0},{"nombre":"PALACIOS ERNESTINA","cuota":2,"estado_correcto":"pagada","monto":81500.0},{"nombre":"PALACIOS ERNESTINA","cuota":3,"estado_correcto":"pagada","monto":81500.0},{"nombre":"CASAS, GUILLERMINA","cuota":1,"estado_correcto":"pagada","monto":82500.0},{"nombre":"CASAS, GUILLERMINA","cuota":2,"estado_correcto":"pagada","monto":82500.0},{"nombre":"CASAS, GUILLERMINA","cuota":3,"estado_correcto":"pagada","monto":82500.0},{"nombre":"DIAZ TORRES, JOSEFINA","cuota":1,"estado_correcto":"pagada","monto":82500.0},{"nombre":"DIAZ TORRES, JOSEFINA","cuota":2,"estado_correcto":"pagada","monto":82500.0},{"nombre":"DIAZ TORRES, JOSEFINA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"LOPEZ, AGNES","cuota":1,"estado_correcto":"pagada","monto":82500.0},{"nombre":"LOPEZ, AGNES","cuota":2,"estado_correcto":"pagada","monto":82500.0},{"nombre":"LOPEZ, AGNES","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MICOL, FRANCISCO","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MICOL, FRANCISCO","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MICOL, FRANCISCO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VITALE GUADALUPE","cuota":1,"estado_correcto":"pagada","monto":133000.0},{"nombre":"VITALE GUADALUPE","cuota":2,"estado_correcto":"pagada","monto":82500.0},{"nombre":"VITALE GUADALUPE","cuota":3,"estado_correcto":"pagada","monto":82500.0},{"nombre":"CAMACHO AMPARO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CAMACHO AMPARO","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CAMACHO AMPARO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CANABIDES, ALLEGRA","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CANABIDES, ALLEGRA","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CANABIDES, ALLEGRA","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"FERNANDEZ AMARELIS","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FERNANDEZ AMARELIS","cuota":2,"estado_correcto":"pagada","monto":42500.0},{"nombre":"FERNANDEZ AMARELIS","cuota":3,"estado_correcto":"pagada","monto":42500.0},{"nombre":"LUNA, SANTINO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"LUNA, SANTINO","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"LUNA, SANTINO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"NUNEZ, ALEXANDER","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"NUNEZ, ALEXANDER","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"NUNEZ, ALEXANDER","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"QUIROGA AMPARO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"QUIROGA AMPARO","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"QUIROGA AMPARO","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"SOSA, SANTIAGO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"SOSA, SANTIAGO","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"SOSA, SANTIAGO","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"TOLABA CARABAJAL KARLA ARIANA","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"TOLABA CARABAJAL KARLA ARIANA","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"TOLABA CARABAJAL KARLA ARIANA","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"ZARATE LUCIA","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"ZARATE LUCIA","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"ZARATE LUCIA","cuota":3,"estado_correcto":"pagada","monto":40000.0},{"nombre":"ALVAREZ LOURDES","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"ALVAREZ LOURDES","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"ALVAREZ LOURDES","cuota":3,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CABRERA AMADEO BENICIO","cuota":1,"estado_correcto":"pagada","monto":42500.0},{"nombre":"CABRERA AMADEO BENICIO","cuota":2,"estado_correcto":"pagada","monto":42500.0},{"nombre":"CABRERA AMADEO BENICIO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GUANCA PATRICIO MATIAS FEDERICO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"GUANCA PATRICIO MATIAS FEDERICO","cuota":2,"estado_correcto":"pagada","monto":40500.0},{"nombre":"GUANCA PATRICIO MATIAS FEDERICO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARRASCO, GAEL TIZIANO","cuota":1,"estado_correcto":"pagada","monto":40500.0},{"nombre":"CARRASCO, GAEL TIZIANO","cuota":2,"estado_correcto":"pagada","monto":42500.0},{"nombre":"CARRASCO, GAEL TIZIANO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA AMADO RUSSO","cuota":1,"estado_correcto":"pagada","monto":155500.0},{"nombre":"FLIA AMADO RUSSO","cuota":2,"estado_correcto":"pagada","monto":155500.0},{"nombre":"FLIA AMADO RUSSO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA BRITO","cuota":1,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA BRITO","cuota":2,"estado_correcto":"pagada","monto":144500.0},{"nombre":"FLIA BRITO","cuota":3,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA COTINI","cuota":1,"estado_correcto":"pagada","monto":100000.0},{"nombre":"FLIA COTINI","cuota":2,"estado_correcto":"pagada","monto":100000.0},{"nombre":"FLIA COTINI","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA CAYO E Y RAFAELA","cuota":1,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA CAYO E Y RAFAELA","cuota":2,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA CAYO E Y RAFAELA","cuota":3,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA CAYO A Y TAIEL","cuota":1,"estado_correcto":"pagada","monto":133000.0},{"nombre":"FLIA CAYO A Y TAIEL","cuota":2,"estado_correcto":"pagada","monto":267000.0},{"nombre":"FLIA CAYO A Y TAIEL","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA DIAZ MORALES","cuota":1,"estado_correcto":"pagada","monto":95000.0},{"nombre":"FLIA DIAZ MORALES","cuota":2,"estado_correcto":"pagada","monto":95000.0},{"nombre":"FLIA DIAZ MORALES","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA LACURI","cuota":1,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA LACURI","cuota":2,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA LACURI","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA MAMANI RUIZ","cuota":1,"estado_correcto":"pagada","monto":156500.0},{"nombre":"FLIA MAMANI RUIZ","cuota":2,"estado_correcto":"pagada","monto":156500.0},{"nombre":"FLIA MAMANI RUIZ","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA MARTINEZ","cuota":1,"estado_correcto":"pagada","monto":82000.0},{"nombre":"FLIA MARTINEZ","cuota":2,"estado_correcto":"pagada","monto":75500.0},{"nombre":"FLIA MARTINEZ","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA MOYA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA MOYA","cuota":2,"estado_correcto":"pagada","monto":144500.0},{"nombre":"FLIA MOYA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA ORTEGA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA ORTEGA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA ORTEGA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA RAMIREZ ORTUNO","cuota":1,"estado_correcto":"pagada","monto":92500.0},{"nombre":"FLIA RAMIREZ ORTUNO","cuota":2,"estado_correcto":"pagada","monto":92500.0},{"nombre":"FLIA RAMIREZ ORTUNO","cuota":3,"estado_correcto":"pagada","monto":92500.0},{"nombre":"FLIA RIVERO","cuota":1,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA RIVERO","cuota":2,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA RIVERO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA ROSAS","cuota":1,"estado_correcto":"pagada","monto":170500.0},{"nombre":"FLIA ROSAS","cuota":2,"estado_correcto":"pagada","monto":170500.0},{"nombre":"FLIA ROSAS","cuota":3,"estado_correcto":"pagada","monto":170500.0},{"nombre":"FLIA RUANO","cuota":1,"estado_correcto":"pagada","monto":89000.0},{"nombre":"FLIA RUANO","cuota":2,"estado_correcto":"pagada","monto":89000.0},{"nombre":"FLIA RUANO","cuota":3,"estado_correcto":"pagada","monto":89000.0},{"nombre":"FLIA OLIVEIRA BEJARANO","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA OLIVEIRA BEJARANO","cuota":2,"estado_correcto":"pagada","monto":118500.0},{"nombre":"FLIA OLIVEIRA BEJARANO","cuota":3,"estado_correcto":"pagada","monto":119000.0},{"nombre":"FLIA SANTAFE","cuota":1,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA SANTAFE","cuota":2,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA SANTAFE","cuota":3,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA GITIAN","cuota":1,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA GITIAN","cuota":2,"estado_correcto":"pagada","monto":261000.0},{"nombre":"FLIA GITIAN","cuota":3,"estado_correcto":"pagada","monto":128000.0},{"nombre":"FLIA SARAVIA","cuota":1,"estado_correcto":"pagada","monto":127000.0},{"nombre":"FLIA SARAVIA","cuota":2,"estado_correcto":"pagada","monto":127000.0},{"nombre":"FLIA SARAVIA","cuota":3,"estado_correcto":"pagada","monto":127000.0},{"nombre":"FLIA SUAREZ","cuota":1,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA SUAREZ","cuota":2,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA SUAREZ","cuota":3,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA TACTAGI","cuota":1,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA TACTAGI","cuota":2,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA TACTAGI","cuota":3,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA TEJERINA","cuota":1,"estado_correcto":"pagada","monto":133000.0},{"nombre":"FLIA TEJERINA","cuota":2,"estado_correcto":"pagada","monto":133000.0},{"nombre":"FLIA TEJERINA","cuota":3,"estado_correcto":"pagada","monto":133000.0},{"nombre":"FLIA TOLABA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA TOLABA","cuota":2,"estado_correcto":"pagada","monto":202000.0},{"nombre":"FLIA TOLABA","cuota":3,"estado_correcto":"pagada","monto":106000.0},{"nombre":"FLIA VACA MONASTEROLO","cuota":1,"estado_correcto":"pagada","monto":156000.0},{"nombre":"FLIA VACA MONASTEROLO","cuota":2,"estado_correcto":"pagada","monto":156000.0},{"nombre":"FLIA VACA MONASTEROLO","cuota":3,"estado_correcto":"pagada","monto":156000.0},{"nombre":"FLIA VERCELLINO R","cuota":1,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA VERCELLINO R","cuota":2,"estado_correcto":"pagada","monto":87000.0},{"nombre":"FLIA VERCELLINO R","cuota":3,"estado_correcto":"pagada","monto":89000.0},{"nombre":"FLIA VILLAFANE GUITIAN","cuota":1,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA VILLAFANE GUITIAN","cuota":2,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA VILLAFANE GUITIAN","cuota":3,"estado_correcto":"pagada","monto":101500.0},{"nombre":"FLIA LIENDRO","cuota":1,"estado_correcto":"pagada","monto":167500.0},{"nombre":"FLIA LIENDRO","cuota":2,"estado_correcto":"pagada","monto":167500.0},{"nombre":"FLIA LIENDRO","cuota":3,"estado_correcto":"pagada","monto":167500.0},{"nombre":"FLIA CARI","cuota":1,"estado_correcto":"pagada","monto":101200.0},{"nombre":"FLIA CARI","cuota":2,"estado_correcto":"pagada","monto":97000.0},{"nombre":"FLIA CARI","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA RIOS","cuota":1,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA RIOS","cuota":2,"estado_correcto":"pagada","monto":132500.0},{"nombre":"FLIA RIOS","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA MARTINEZ ISAIAS TOBIAS","cuota":1,"estado_correcto":"pagada","monto":52500.0},{"nombre":"FLIA MARTINEZ ISAIAS TOBIAS","cuota":2,"estado_correcto":"pagada","monto":52500.0},{"nombre":"FLIA MARTINEZ ISAIAS TOBIAS","cuota":3,"estado_correcto":"pagada","monto":52500.0},{"nombre":"FLIA GASPAR GUITIAN","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA GASPAR GUITIAN","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA GASPAR GUITIAN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA FECCIA","cuota":1,"estado_correcto":"pagada","monto":91500.0},{"nombre":"FLIA FECCIA","cuota":2,"estado_correcto":"pagada","monto":91500.0},{"nombre":"FLIA FECCIA","cuota":3,"estado_correcto":"pagada","monto":91500.0},{"nombre":"FLIA RIOS THIAGO RUTH","cuota":1,"estado_correcto":"pagada","monto":154000.0},{"nombre":"FLIA RIOS THIAGO RUTH","cuota":2,"estado_correcto":"pagada","monto":138500.0},{"nombre":"FLIA RIOS THIAGO RUTH","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLIA CASIMIRO","cuota":1,"estado_correcto":"pagada","monto":118000.0},{"nombre":"FLIA CASIMIRO","cuota":2,"estado_correcto":"pagada","monto":129000.0},{"nombre":"FLIA CASIMIRO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ANTUNA MAITENA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ANTUNA MAITENA","cuota":2,"estado_correcto":"pagada","monto":50000.0},{"nombre":"ANTUNA MAITENA","cuota":3,"estado_correcto":"pagada","monto":50000.0},{"nombre":"CABRAL SIMON","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"CABRAL SIMON","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"CABRAL SIMON","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"CARDENAS, MAILEN","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARDENAS, MAILEN","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARDENAS, MAILEN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CRUZ, LUDMILA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CRUZ, LUDMILA","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CRUZ, LUDMILA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GUANCA, YAHIR","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"GUANCA, YAHIR","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"GUANCA, YAHIR","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"SORIA LIENDRO, LIA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"SORIA LIENDRO, LIA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"SORIA LIENDRO, LIA","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"CRUZ, EMA ISABELLA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"CRUZ, EMA ISABELLA","cuota":2,"estado_correcto":"pagada","monto":5950.0},{"nombre":"CRUZ, EMA ISABELLA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ROJAS, JAZMIN","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ROJAS, JAZMIN","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ROJAS, JAZMIN","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"REALES, LAUTARO","cuota":1,"estado_correcto":"pagada","monto":59000.0},{"nombre":"REALES, LAUTARO","cuota":2,"estado_correcto":"pagada","monto":59000.0},{"nombre":"REALES, LAUTARO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"SEGURA, VICTORIA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"SEGURA, VICTORIA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"SEGURA, VICTORIA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"SOTILLO CATALINA","cuota":1,"estado_correcto":"pagada","monto":59000.0},{"nombre":"SOTILLO CATALINA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"SOTILLO CATALINA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"YAPURA, BAUTISTA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"YAPURA, BAUTISTA","cuota":2,"estado_correcto":"pagada","monto":50000.0},{"nombre":"YAPURA, BAUTISTA","cuota":3,"estado_correcto":"pagada","monto":50000.0},{"nombre":"ROBLEDO MAXIMO","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ROBLEDO MAXIMO","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ROBLEDO MAXIMO","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"LAIME, DAIANA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"LAIME, DAIANA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"LAIME, DAIANA","cuota":3,"estado_correcto":"pagada","monto":112000.0},{"nombre":"ORELLANA, ORIANA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ORELLANA, ORIANA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ORELLANA, ORIANA","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"RICCO, TIZIANO","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"RICCO, TIZIANO","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"RICCO, TIZIANO","cuota":3,"estado_correcto":"pagada","monto":112000.0},{"nombre":"RODRIGUEZ, GENESIS","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"RODRIGUEZ, GENESIS","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"RODRIGUEZ, GENESIS","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"TOLABA, JEREMIAS","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"TOLABA, JEREMIAS","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"TOLABA, JEREMIAS","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ALCALA BAUTISTA","cuota":1,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ALCALA BAUTISTA","cuota":2,"estado_correcto":"pagada","monto":56000.0},{"nombre":"ALCALA BAUTISTA","cuota":3,"estado_correcto":"pagada","monto":56000.0},{"nombre":"MOLINA GUADALUPE","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MOLINA GUADALUPE","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MOLINA GUADALUPE","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARRASCO, MATEO","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CARRASCO, MATEO","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CARRASCO, MATEO","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CESPEDES PUPPI, JUAN EMILIO","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CESPEDES PUPPI, JUAN EMILIO","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CESPEDES PUPPI, JUAN EMILIO","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CHOQUE JESUS GABRIEL","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CHOQUE JESUS GABRIEL","cuota":2,"estado_correcto":"pagada","monto":48000.0},{"nombre":"CHOQUE JESUS GABRIEL","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GARCIA CARBAJAL, VALENTINO GABRIEL","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"GARCIA CARBAJAL, VALENTINO GABRIEL","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GARCIA CARBAJAL, VALENTINO GABRIEL","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"FLORES LUCAS","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"FLORES LUCAS","cuota":2,"estado_correcto":"pagada","monto":48000.0},{"nombre":"FLORES LUCAS","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"GERON CARMEN","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GERON CARMEN","cuota":2,"estado_correcto":"pagada","monto":96000.0},{"nombre":"GERON CARMEN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GUTIERREZ, EMMA","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"GUTIERREZ, EMMA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"GUTIERREZ, EMMA","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"MONTES, LOLA","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"MONTES, LOLA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"MONTES, LOLA","cuota":3,"estado_correcto":"pagada","monto":45000.0},{"nombre":"PARRILLA, VALENTINA","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"PARRILLA, VALENTINA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"PARRILLA, VALENTINA","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"POSADAS, JEREMIAS","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"POSADAS, JEREMIAS","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"POSADAS, JEREMIAS","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"RIVERO, AGUSTIN","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"RIVERO, AGUSTIN","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"RIVERO, AGUSTIN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"SANGUEZO MIRANDA, LUZ","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"SANGUEZO MIRANDA, LUZ","cuota":2,"estado_correcto":"pagada","monto":91000.0},{"nombre":"SANGUEZO MIRANDA, LUZ","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"TERCERO, MATEO","cuota":1,"estado_correcto":"pagada","monto":48000.0},{"nombre":"TERCERO, MATEO","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"TERCERO, MATEO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VEDIA, FELIPE","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VEDIA, FELIPE","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VEDIA, FELIPE","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VELA, NAHIARA","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VELA, NAHIARA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VELA, NAHIARA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ZARATE FRANCESCA","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"ZARATE FRANCESCA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"ZARATE FRANCESCA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"NERI SALVADOR","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"NERI SALVADOR","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"NERI SALVADOR","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CARMEN GUILLERMINA","cuota":1,"estado_correcto":"pagada","monto":48000.0},{"nombre":"CARMEN GUILLERMINA","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"CARMEN GUILLERMINA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ABALOS, AYLEN","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ABALOS, AYLEN","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ABALOS, AYLEN","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ACOSTA MIA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ACOSTA MIA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ACOSTA MIA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"AGUILERA, MIA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"AGUILERA, MIA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"AGUILERA, MIA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ANTONELLI, DONATO","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ANTONELLI, DONATO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ANTONELLI, DONATO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CAMPOS GIOVANI","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CAMPOS GIOVANI","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CAMPOS GIOVANI","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CASTRO, AGUSTIN","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"CASTRO, AGUSTIN","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"CASTRO, AGUSTIN","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"GOMEZ, NAZARENO","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"GOMEZ, NAZARENO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"GOMEZ, NAZARENO","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"GUTIERREZ, ZOEMI","cuota":1,"estado_correcto":"pagada","monto":45500.0},{"nombre":"GUTIERREZ, ZOEMI","cuota":2,"estado_correcto":"pagada","monto":45000.0},{"nombre":"GUTIERREZ, ZOEMI","cuota":3,"estado_correcto":"pagada","monto":45000.0},{"nombre":"PERALES, MARIA CECILIA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"PERALES, MARIA CECILIA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"PERALES, MARIA CECILIA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"PERCINO, NAHIARA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"PERCINO, NAHIARA","cuota":2,"estado_correcto":"pagada","monto":53000.0},{"nombre":"PERCINO, NAHIARA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"TOLABA, ESTEFANIA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"TOLABA, ESTEFANIA","cuota":2,"estado_correcto":"pagada","monto":53000.0},{"nombre":"TOLABA, ESTEFANIA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"TOMASINI AGUSTIN","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"TOMASINI AGUSTIN","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"TOMASINI AGUSTIN","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"YURKINA, MISAEL","cuota":1,"estado_correcto":"pagada","monto":45000.0},{"nombre":"YURKINA, MISAEL","cuota":2,"estado_correcto":"pagada","monto":45500.0},{"nombre":"YURKINA, MISAEL","cuota":3,"estado_correcto":"pagada","monto":45500.0},{"nombre":"VARGAS THIAGO","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VARGAS THIAGO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VARGAS THIAGO","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"TAGLIOLI ANA","cuota":1,"estado_correcto":"pagada","monto":53000.0},{"nombre":"TAGLIOLI ANA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"TAGLIOLI ANA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VILCA ESPERANZA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VILCA ESPERANZA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VILCA ESPERANZA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"FACCHIN, OLIVIA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"FACCHIN, OLIVIA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"FACCHIN, OLIVIA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"LOPEZ ESTEFANIA","cuota":1,"estado_correcto":"pagada","monto":111000.0},{"nombre":"LOPEZ ESTEFANIA","cuota":2,"estado_correcto":"pagada","monto":90000.0},{"nombre":"LOPEZ ESTEFANIA","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MANSILLA, ABRIL","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MANSILLA, ABRIL","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MANSILLA, ABRIL","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"MONDAQUE SABRINA","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MONDAQUE SABRINA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MONDAQUE SABRINA","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"REMENTERIA ISABEL","cuota":1,"estado_correcto":"pagada","monto":93000.0},{"nombre":"REMENTERIA ISABEL","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"REMENTERIA ISABEL","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MOSA, TADEO","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MOSA, TADEO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"MOSA, TADEO","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"OROZCO, LAUTARO","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"OROZCO, LAUTARO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"OROZCO, LAUTARO","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"ORTEGA MARCOS","cuota":1,"estado_correcto":"pagada","monto":53000.0},{"nombre":"ORTEGA MARCOS","cuota":2,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ORTEGA MARCOS","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"VILLANUEVA CARLOS","cuota":1,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VILLANUEVA CARLOS","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"VILLANUEVA CARLOS","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"GUAYMAS ZERPA, CIRO","cuota":1,"estado_correcto":"pagada","monto":45000.0},{"nombre":"GUAYMAS ZERPA, CIRO","cuota":2,"estado_correcto":"pagada","monto":45000.0},{"nombre":"GUAYMAS ZERPA, CIRO","cuota":3,"estado_correcto":"pagada","monto":45000.0},{"nombre":"CABELLO ALMA","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"CABELLO ALMA","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"CABELLO ALMA","cuota":3,"estado_correcto":"pagada","monto":53000.0},{"nombre":"FIRME TIZIANO","cuota":1,"estado_correcto":"pagada","monto":53000.0},{"nombre":"FIRME TIZIANO","cuota":2,"estado_correcto":"pagada","monto":50500.0},{"nombre":"FIRME TIZIANO","cuota":3,"estado_correcto":"pagada","monto":50500.0},{"nombre":"CHAVEZ DI PAULI CATALINA","cuota":1,"estado_correcto":"pagada","monto":29000.0},{"nombre":"CHAVEZ DI PAULI CATALINA","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"CHAVEZ DI PAULI CATALINA","cuota":3,"estado_correcto":"pagada","monto":27500.0},{"nombre":"MAMANI, FELICITAS","cuota":1,"estado_correcto":"pagada","monto":27500.0},{"nombre":"MAMANI, FELICITAS","cuota":2,"estado_correcto":"pagada","monto":29000.0},{"nombre":"MAMANI, FELICITAS","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ALANCAY DEMIR","cuota":1,"estado_correcto":"pendiente","monto":0.0},{"nombre":"ALANCAY DEMIR","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"ALANCAY DEMIR","cuota":3,"estado_correcto":"pendiente","monto":0.0},{"nombre":"RAMPULLA, GINO","cuota":1,"estado_correcto":"pagada","monto":27500.0},{"nombre":"RAMPULLA, GINO","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"RAMPULLA, GINO","cuota":3,"estado_correcto":"pagada","monto":27500.0},{"nombre":"ZERPA, MATHEO","cuota":1,"estado_correcto":"pagada","monto":24700.0},{"nombre":"ZERPA, MATHEO","cuota":2,"estado_correcto":"pagada","monto":24700.0},{"nombre":"ZERPA, MATHEO","cuota":3,"estado_correcto":"pagada","monto":24700.0},{"nombre":"APARICIO ROYANO NAHYARA","cuota":1,"estado_correcto":"pagada","monto":27500.0},{"nombre":"APARICIO ROYANO NAHYARA","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"APARICIO ROYANO NAHYARA","cuota":3,"estado_correcto":"pagada","monto":27500.0},{"nombre":"VILTE PAZ LORENA SOL","cuota":1,"estado_correcto":"pagada","monto":27500.0},{"nombre":"VILTE PAZ LORENA SOL","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"VILTE PAZ LORENA SOL","cuota":3,"estado_correcto":"pagada","monto":27500.0},{"nombre":"CORONEL LAUTARO","cuota":1,"estado_correcto":"pagada","monto":29000.0},{"nombre":"CORONEL LAUTARO","cuota":2,"estado_correcto":"pagada","monto":27500.0},{"nombre":"CORONEL LAUTARO","cuota":3,"estado_correcto":"pagada","monto":27500.0},{"nombre":"VILLANUEVA FRANCISCO","cuota":1,"estado_correcto":"pagada","monto":29000.0},{"nombre":"VILLANUEVA FRANCISCO","cuota":2,"estado_correcto":"pagada","monto":25000.0},{"nombre":"VILLANUEVA FRANCISCO","cuota":3,"estado_correcto":"pagada","monto":27500.0}];

  let corregidas = 0;
  const errores = [];

  for (const item of ESTADOS_EXCEL) {
    if (item.estado_correcto !== 'pendiente') continue;

    // Buscar el alumno
    const alumno = await q1('SELECT id FROM alumnos WHERE nombre = $1', [item.nombre]);
    if (!alumno) { errores.push('No encontrado: ' + item.nombre); continue; }

    // Verificar si la cuota está mal (pagada cuando debería ser pendiente)
    const cuota = await q1('SELECT * FROM cuotas WHERE alumno_id=$1 AND numero_cuota=$2', [alumno.id, item.cuota]);
    if (cuota && cuota.estado === 'pagada') {
      await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
        ['pendiente','',0,alumno.id,item.cuota]);
      corregidas++;
    }
  }

  res.json({ ok: true, corregidas, errores, mensaje: `${corregidas} cuotas corregidas al estado original del Excel` });
});

// Corregir cuota específica de un alumno
app.get('/api/corregir-cuota/:alumnoId/:numCuota/:estado', async (req,res) => {
  const { alumnoId, numCuota, estado } = req.params;
  if (!['pagada','pendiente'].includes(estado)) return res.json({ ok: false, error: 'Estado inválido' });
  if (estado === 'pendiente') {
    await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE alumno_id=$4 AND numero_cuota=$5',
      ['pendiente','',0,alumnoId,numCuota]);
  }
  res.json({ ok: true, alumnoId, numCuota, estado });
});

// Re-aplicar pagos bancarios que quedaron sin cuota asignada
app.get('/api/reaplicar-pagos-banco', async (req,res) => {
  const dia = 19; // Día de pago original del banco
  let aplicados = 0;

  // Buscar pagos bancarios cuyo concepto es "Transferencia bancaria" (sin cuota asignada)
  const pagosHuerfanos = await q(
    "SELECT p.*, a.precio_normal, a.precio_bonificado FROM pagos p JOIN alumnos a ON p.alumno_id=a.id WHERE p.origen LIKE '%Banco%' AND (p.concepto='Transferencia bancaria' OR p.concepto LIKE '%saldo%')"
  );

  for (const pago of pagosHuerfanos) {
    const pendientes = await q(
      'SELECT * FROM cuotas WHERE alumno_id=$1 AND estado=$2 ORDER BY numero_cuota',
      [pago.alumno_id, 'pendiente']
    );
    if (!pendientes.length) continue;

    let restante = parseFloat(pago.monto);
    const conceptos = [];

    for (const c of pendientes) {
      if (restante <= 0) break;
      const esBonif = MESES_TODO_EL_MES.includes(c.numero_cuota) || dia <= 10;
      const precio = esBonif ? parseFloat(pago.precio_bonificado) : parseFloat(pago.precio_normal);
      if (restante >= precio) {
        await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4',
          ['pagada', pago.fecha, precio, c.id]);
        conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE_ALL[c.numero_cuota-1]} 2026)`);
        restante -= precio;
      }
    }

    if (conceptos.length > 0) {
      const nuevoConc = conceptos.join(', ') + (restante > 0 ? ` + saldo $${Math.round(restante).toLocaleString('es-AR')}` : '');
      await q('UPDATE pagos SET concepto=$1 WHERE id=$2', [nuevoConc, pago.id]);
      aplicados++;
    }
  }

  res.json({ ok: true, pagosReaplicados: aplicados, mensaje: `${aplicados} pagos bancarios re-aplicados a cuotas` });
});

// Aplicar saldo disponible a cuotas pendientes para todos los alumnos con saldo sin aplicar
app.get('/api/aplicar-saldos-pendientes', async (req,res) => {
  const alumnos = await q('SELECT * FROM alumnos WHERE activo=TRUE ORDER BY nombre');
  let corregidos = 0;
  const detalle = [];

  for (const a of alumnos) {
    const totalPagado = parseFloat((await q1('SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE alumno_id=$1',[a.id]))?.t||0);
    const cuotas = await q('SELECT * FROM cuotas WHERE alumno_id=$1 ORDER BY numero_cuota',[a.id]);
    const totalAplicado = cuotas.filter(c=>c.estado==='pagada').reduce((s,c)=>s+parseFloat(c.monto_pagado||0),0);
    let saldo = totalPagado - totalAplicado;

    if (saldo < 100) continue;

    const pendientes = cuotas.filter(c=>c.estado==='pendiente').sort((a,b)=>a.numero_cuota-b.numero_cuota);
    if (!pendientes.length) continue;

    const dia = 19; // Día de referencia para precios
    const cuotasAplicadas = [];

    for (const c of pendientes) {
      if (saldo <= 0) break;
      const esBonif = MESES_TODO_EL_MES.includes(c.numero_cuota) || dia <= 10;
      const precio = esBonif ? parseFloat(a.precio_bonificado) : parseFloat(a.precio_normal);
      if (saldo >= precio * 0.9) { // 90% mínimo para cubrir la cuota
        await q('UPDATE cuotas SET estado=$1,fecha_pago=$2,monto_pagado=$3 WHERE id=$4',
          ['pagada', '19/5/2026', precio, c.id]);
        cuotasAplicadas.push(c.numero_cuota);
        saldo -= precio;
      }
    }

    if (cuotasAplicadas.length > 0) {
      // Actualizar concepto del último pago bancario
      const ultimoPago = await q1(
        "SELECT * FROM pagos WHERE alumno_id=$1 AND origen LIKE '%Banco%' ORDER BY id DESC LIMIT 1",
        [a.id]
      );
      if (ultimoPago) {
        const nuevoConc = ultimoPago.concepto + ', ' + cuotasAplicadas.map(n=>`Cuota ${n} (${MESES_NOMBRE_ALL[n-1]} 2026)`).join(', ');
        await q('UPDATE pagos SET concepto=$1 WHERE id=$2',[nuevoConc, ultimoPago.id]);
      }
      corregidos++;
      detalle.push({ nombre: a.nombre, cuotasAplicadas });
    }
  }

  res.json({ ok: true, corregidos, detalle });
});

// Verificar qué alumnos tienen saldo sin aplicar (pagos sin cuota asignada)
app.get('/api/diagnostico/saldos-sin-aplicar', async (req,res) => {
  const alumnos = await q('SELECT * FROM alumnos WHERE activo=TRUE ORDER BY nombre');
  const resultado = [];
  for (const a of alumnos) {
    const totalPagado = parseFloat((await q1('SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE alumno_id=$1',[a.id]))?.t||0);
    const cuotas = await q('SELECT * FROM cuotas WHERE alumno_id=$1',[a.id]);
    const totalAplicado = cuotas.filter(c=>c.estado==='pagada').reduce((s,c)=>s+parseFloat(c.monto_pagado||0),0);
    const saldo = totalPagado - totalAplicado;
    if (saldo >= 100) {
      const pendientes = cuotas.filter(c=>c.estado==='pendiente').map(c=>c.numero_cuota);
      resultado.push({ nombre: a.nombre, id: a.id, totalPagado, totalAplicado, saldo, cuotasPendientes: pendientes });
    }
  }
  res.json({ total: resultado.length, alumnos: resultado });
});

// Ruta manual para ejecutar backup
app.get('/api/backup', (req,res) => {
  res.set('Content-Type','application/json');
  res.send('{"ok":true}');
  // Ejecutar backup después de responder
  ejecutarBackup().catch(e => console.error('Error backup:', e));
});

// ================================================================
// BACKUP AUTOMÁTICO A GOOGLE SHEETS
// ================================================================
const SHEET_ID = '16aU_TffL58PWkSGIIMj3JkSCtj1kh682bsF8zshexsE';
const SERVICE_ACCOUNT = {
  client_email: 'cobranzas-backup@crypto-trail-496813-t8.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwwZw/OdSOveeU\nu34q2g3Z3h8CsvfqgR8RqqA7t7c8xMTeT5/poK1IF2tNRcVUIsE77zplj11bgdmD\nkG/hPgGamq6HYJNwMYuahOFwB79p6ei0NMz0ecxzta2CVmjuNhVL0QlelGGumEby\nCxnphxywOhi+z+26PjFS4CGbw+zzgSLVBXg8JCthyUcdnIh0zb2057an8d+9tQ+3\nmlLDg1NYh6dg5VVXzbmK4GoNwoPT7O0c7UXoj08KW1ptLgIekOTxLqPOv/Go9B84\n1juPJdljqCWe43OPhiC/Rh730UIwowPW0qqopxKmi5R7FJcPXOC4VpB5VgaeF2KL\nWh2/tHTTAgMBAAECggEAAY+7RCmRAazH86LLQSArIswC/uNxFSx1WXiuOQX1P4oN\nj1+pd9rpIk1dH0aUb3Oo4/VLIzUoX4k2jqxJBnoH4TzPzxFf+z0oF0B1noAFe6i8\nLTIh5/Dt3iKUwhhV/TkJpsPVsW5uZIecTzFiRYzoL/97Lv5koBQHL+CfQYmz1V9A\neQ5CDsLUh0vhOJl++lb0+V+/RuG2YT7p6vkau+WwhrUfJhNzo9Kg1z3ubedPLkCA\nRxFZ/E6FwerSaFNAEmjBnS+VBp3svFpBwEL7Ve9T4vsvfshWjJwMwHBw8cYGp3iO\ni0ktfoZxISVxDZPuCJiCEfTtfEbAXTF6lxCN7mN3YQKBgQDfPt72mkEa/ZR1VKqc\nAaapn26NLeRKVqIa2+5lQWnZ5dHlGuw5G5Od44zOhWTqr7BHgRQkyddvgft0EsQs\ngNz4cGKHCLSv3y9IybCuKTFPo/8H59Oe8uh3Gbm1x+g4upoUSUfAMMzw/ORlmPG0\n5ckMTHixB6vHluzYSyhVgoW6AwKBgQDKsJieRmTP+ywZN7S87+BfR0G/vocc7rpM\n8o2XmYSUEGsJhkEvyQcq+7a7v7J1rXnxo5vNJ5v8xYlDtobpKnXWlBCC7nC5KAk6\nUbTtzs9qyL6Sf7oVBfPrwe7NXX2dAlQN85gQKYjyE/RrgpwwrBZgIFhu+MnJ6JbP\nt1xS9irI8QKBgQC8/aORjsrZB517qr54Lami5XaYjCY8jJTVOiTakYMD1VxYoO8j\n9WWFf5K/bwwc5bjM/8hG0JzSKG7wN8bdigYHSFUQzdzxGncUHrK07ehx7HrFfYuY\nfzkvQpcF/gNoqwgvbk4QtP96cA0GuXC93N3TzJVMARt6bxl4jj/KDCIbcwKBgC/G\nFgLgRqy63/cFqUULKRBsBDREnSYVorW2SedcmOIpSIFTMpQnxte7wqNYGKEiBWcO\nEA/38Q1QJf1ezUex6VptRcMGnm0V4a7sST/wCfV6YWi4UEzaPVbpO/cNvSi/vr4X\nF1Vf5NZiG68ndtcGCLQZi56EZ1N+zeUhq9ImEYmRAoGBAKKRux+H25C/MZW56cuu\n2JgZfmQKNyC+myt+oZQrB1MggETr7h4i0Z9oarYj0nfd3IAsStU5NMJvZAAPj6iz\ncJr9JzLihSMDadPxLYVInoUx/pwWC02ivHikAINrDQXYCrMmvbae44Rhs4QnScEA\n5iojtl3Rkc4jyxvX4jKKtHfc\n-----END PRIVATE KEY-----\n'
};

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(SERVICE_ACCOUNT.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  return data.access_token;
}

async function sheetsRequest(token, method, path, body) {
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method, headers: {'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined
  });
  return resp.json();
}

async function ejecutarBackup() {
  console.log('Iniciando backup a Google Sheets...');
  const token = await getAccessToken();

  // Obtener hojas existentes
  const meta = await sheetsRequest(token, 'GET', '', null);
  const hojas = (meta.sheets||[]).map(s=>s.properties.title);

  // Función para crear hoja si no existe
  async function asegurarHoja(nombre) {
    if (!hojas.includes(nombre)) {
      await sheetsRequest(token, 'POST', ':batchUpdate', {
        requests:[{addSheet:{properties:{title:nombre}}}]
      });
    }
  }

  const fecha = new Date().toLocaleDateString('es-AR');
  const hora = new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});

  // 1. BACKUP ALUMNOS
  await asegurarHoja('Alumnos_Backup');
  const alumnos = await q('SELECT * FROM alumnos ORDER BY nombre');
  const rowsAlumnos = [
    ['ID','Nombre','Curso','CUITs','Precio Normal','Precio Bonificado','Activo','Telefono','Backup: '+fecha+' '+hora],
    ...alumnos.map(a=>[a.id,a.nombre,a.curso,a.cuits,parseFloat(a.precio_normal),parseFloat(a.precio_bonificado),a.activo?'Si':'No',a.telefono||''])
  ];
  await sheetsRequest(token,'PUT',`/values/Alumnos_Backup!A1:I${rowsAlumnos.length}?valueInputOption=RAW`,{values:rowsAlumnos});

  // 2. BACKUP PAGOS
  await asegurarHoja('Pagos_Backup');
  const pagos = await q('SELECT * FROM pagos ORDER BY id');
  const rowsPagos = [
    ['ID','Fecha','Alumno','Curso','Monto','Concepto','Medio','Origen','Backup: '+fecha+' '+hora],
    ...pagos.map(p=>[p.id,p.fecha,p.alumno_nombre,p.curso,parseFloat(p.monto),p.concepto,p.medio,p.origen])
  ];
  await sheetsRequest(token,'PUT',`/values/Pagos_Backup!A1:I${rowsPagos.length}?valueInputOption=RAW`,{values:rowsPagos});

  // 3. BACKUP CUOTAS
  await asegurarHoja('Cuotas_Backup');
  const cuotas = await q('SELECT c.*,a.nombre FROM cuotas c JOIN alumnos a ON c.alumno_id=a.id ORDER BY a.nombre,c.numero_cuota');
  const rowsCuotas = [
    ['ID','Alumno','Cuota','Estado','Fecha Pago','Monto Pagado','Backup: '+fecha+' '+hora],
    ...cuotas.map(c=>[c.id,c.nombre,c.numero_cuota,c.estado,c.fecha_pago||'',parseFloat(c.monto_pagado)||0])
  ];
  await sheetsRequest(token,'PUT',`/values/Cuotas_Backup!A1:G${rowsCuotas.length}?valueInputOption=RAW`,{values:rowsCuotas});

  console.log(`Backup completado: ${alumnos.length} alumnos, ${pagos.length} pagos, ${cuotas.length} cuotas`);
}

// Ejecutar backup cada 24 horas
function programarBackup() {
  // Primer backup a las 3 AM hora Argentina (UTC-3 = 6 AM UTC)
  const ahora = new Date();
  const proximoBackup = new Date();
  proximoBackup.setUTCHours(6, 0, 0, 0);
  if (proximoBackup <= ahora) proximoBackup.setUTCDate(proximoBackup.getUTCDate() + 1);
  const msHasta = proximoBackup - ahora;
  console.log(`Próximo backup automático en ${Math.round(msHasta/1000/60)} minutos`);
  setTimeout(() => {
    ejecutarBackup().catch(e => console.error('Error backup:', e));
    setInterval(() => ejecutarBackup().catch(e => console.error('Error backup:', e)), 24*60*60*1000);
  }, msHasta);
}

// ================================================================
// MODO DEMO — variables ya declaradas al inicio
// ================================================================
let systemRecoveryCode = null;
let systemRecoveryExpiry = null;

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === systemPassword });
});

app.post('/api/login/recuperar', async (req, res) => {
  systemRecoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
  systemRecoveryExpiry = Date.now() + 15 * 60 * 1000;
  console.log(`=== CÓDIGO RECUPERACIÓN SISTEMA: ${systemRecoveryCode} (válido 15 min) ===`);
  res.json({ ok: true });
});

app.post('/api/login/verificar', (req, res) => {
  const { codigo, nuevaClave } = req.body;
  if (!systemRecoveryCode || Date.now() > systemRecoveryExpiry)
    return res.json({ ok: false, error: 'El código expiró. Solicitá uno nuevo.' });
  if (codigo !== systemRecoveryCode)
    return res.json({ ok: false, error: 'Código incorrecto.' });
  systemPassword = nuevaClave;
  systemRecoveryCode = null;
  systemRecoveryExpiry = null;
  res.json({ ok: true });
});

// ================================================================
// ADMINISTRACIÓN — AUTH Y ESTADÍSTICAS
// ================================================================
const ADMIN_EMAIL = 'jzitelli@gmail.com';
let adminPassword = process.env.ADMIN_PASSWORD || (DEMO_MODE ? 'DEMO2024' : 'Stefano2008');
let systemPassword = process.env.SYSTEM_PASSWORD || (DEMO_MODE ? 'DEMO' : '1997');
let recoveryCode = null;
let recoveryExpiry = null;

app.post('/api/admin/cambiar-clave', (req,res) => {
  const {claveActual, nuevaClave} = req.body;
  if (claveActual !== adminPassword) return res.json({ok:false, error:'Clave actual incorrecta.'});
  if (!nuevaClave || nuevaClave.length < 4) return res.json({ok:false, error:'La nueva clave debe tener al menos 4 caracteres.'});
  adminPassword = nuevaClave;
  res.json({ok:true});
});

app.post('/api/sistema/cambiar-clave', (req,res) => {
  const {claveActual, nuevaClave} = req.body;
  if (claveActual !== systemPassword) return res.json({ok:false, error:'Clave actual incorrecta.'});
  if (!nuevaClave || nuevaClave.length < 4) return res.json({ok:false, error:'La nueva clave debe tener al menos 4 caracteres.'});
  systemPassword = nuevaClave;
  res.json({ok:true});
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === adminPassword });
});

app.post('/api/admin/recuperar', async (req, res) => {
  recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
  recoveryExpiry = Date.now() + 15 * 60 * 1000;
  console.log(`=== CÓDIGO DE RECUPERACIÓN ADMIN: ${recoveryCode} (válido 15 min) ===`);
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: 'service_gmail', template_id: 'template_recovery', user_id: 'placeholder', template_params: { to_email: ADMIN_EMAIL, code: recoveryCode } })
    });
  } catch(e) { console.log('Email no enviado:', e.message); }
  res.json({ ok: true, mensaje: `Código enviado a ${ADMIN_EMAIL.slice(0,2)}***@gmail.com. Si no llega, revisá los logs de Render.` });
});

app.post('/api/admin/verificar-codigo', (req, res) => {
  const { codigo, nuevaClave } = req.body;
  if (!recoveryCode || Date.now() > recoveryExpiry) return res.json({ ok: false, error: 'El código expiró. Solicitá uno nuevo.' });
  if (codigo !== recoveryCode) return res.json({ ok: false, error: 'Código incorrecto.' });
  adminPassword = nuevaClave;
  recoveryCode = null; recoveryExpiry = null;
  res.json({ ok: true });
});

app.get('/api/admin/stats', async (req, res) => {
  const [totalAlumnos, totalPagos, porMedio, deudores, porCurso] = await Promise.all([
    q1('SELECT COUNT(*) as n FROM alumnos WHERE activo=TRUE'),
    q1('SELECT COUNT(*) as n, COALESCE(SUM(monto),0) as total FROM pagos'),
    q('SELECT medio, COUNT(*) as cantidad, SUM(monto) as total FROM pagos GROUP BY medio ORDER BY total DESC'),
    q1('SELECT COUNT(DISTINCT alumno_id) as n FROM cuotas WHERE estado=$1', ['pendiente']),
    q(`SELECT a.curso, COUNT(DISTINCT a.id) as alumnos, COALESCE(SUM(p.monto),0) as cobrado FROM alumnos a LEFT JOIN pagos p ON a.id=p.alumno_id WHERE a.activo=TRUE GROUP BY a.curso ORDER BY cobrado DESC`)
  ]);
  const alDia = parseInt(totalAlumnos?.n||0) - parseInt(deudores?.n||0);

  // Calcular deuda total con consultas masivas
  const alumnos = await q('SELECT * FROM alumnos WHERE activo=TRUE');
  const todasCuotas = await q('SELECT * FROM cuotas WHERE alumno_id=ANY($1)', [alumnos.map(a=>a.id)]);
  const todosPagos = await q('SELECT alumno_id, COALESCE(SUM(monto),0) as total FROM pagos WHERE alumno_id=ANY($1) GROUP BY alumno_id', [alumnos.map(a=>a.id)]);
  const mapPagos = {};
  todosPagos.forEach(p => { mapPagos[p.alumno_id] = parseFloat(p.total||0); });
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const dia = hoy.getDate();
  let totalDeuda = 0;
  for (const a of alumnos) {
    const cuotas = todasCuotas.filter(c => c.alumno_id === a.id);
    const totalPagadoA = mapPagos[a.id] || 0;
    let totalDebido = 0;
    for (let i = 0; i < 10; i++) {
      if (MESES_IDX[i] > mesActual) continue;
      totalDebido += getPrecio(a, i+1, dia);
    }
    const saldo = totalPagadoA - totalDebido;
    if (saldo < 0) totalDeuda += Math.abs(saldo);
  }

  res.json({ totalAlumnos: parseInt(totalAlumnos?.n||0), totalPagos: parseInt(totalPagos?.n||0), totalCobrado: parseFloat(totalPagos?.total||0), conDeuda: parseInt(deudores?.n||0), alDia, totalDeuda, porMedio, porCurso });
});

app.get('*', (req,res) => { res.sendFile(path.join(__dirname,'public','index.html')); });

async function inicializarConRetry(intentos=5, delay=5000) {
  for (let i = 1; i <= intentos; i++) {
    try {
      console.log(`Intento ${i} de conexión a la DB...`);
      await inicializarDB();
      console.log('DB conectada OK');
      return;
    } catch(err) {
      console.error(`Error intento ${i}:`, err.message);
      if (i === intentos) { console.error('No se pudo conectar a la DB'); process.exit(1); }
      console.log(`Reintentando en ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function keepAliveDB() {
  setInterval(async () => {
    try { await q('SELECT 1'); } catch(e) {}
  }, 4 * 60 * 1000); // cada 4 minutos
}

inicializarConRetry().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    programarBackup();
    keepAliveDB();
  });
});
