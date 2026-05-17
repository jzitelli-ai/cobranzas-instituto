const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Base de datos SQLite
const db = new Database('./cobranzas.db');

// Inicializar tablas
db.exec(`
  CREATE TABLE IF NOT EXISTS cursos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    activo INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS alumnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    curso TEXT NOT NULL,
    cuits TEXT DEFAULT '',
    precio_normal REAL DEFAULT 0,
    precio_bonificado REAL DEFAULT 0,
    activo INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS cuotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alumno_id INTEGER NOT NULL,
    numero_cuota INTEGER NOT NULL,
    estado TEXT DEFAULT 'pendiente',
    fecha_pago TEXT DEFAULT '',
    monto_pagado REAL DEFAULT 0,
    compensada INTEGER DEFAULT 0,
    UNIQUE(alumno_id, numero_cuota)
  );

  CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    alumno_id INTEGER NOT NULL,
    alumno_nombre TEXT NOT NULL,
    curso TEXT NOT NULL,
    monto REAL NOT NULL,
    concepto TEXT NOT NULL,
    medio TEXT NOT NULL,
    origen TEXT NOT NULL,
    saldo_favor REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS aranceles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    desde TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    creado TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS aranceles_precios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arancel_id INTEGER NOT NULL,
    alumno_id INTEGER NOT NULL,
    precio_normal REAL DEFAULT 0,
    precio_bonificado REAL DEFAULT 0
  );
`);

// Verificar si ya se cargaron los datos iniciales
const iniciado = db.prepare("SELECT valor FROM config WHERE clave = 'iniciado'").get();
if (!iniciado) {
  cargarDatosIniciales();
}

function cargarDatosIniciales() {
  const cursos = ['1ST','1ST INT','2ND YEAR','5TH INT','6TH INT','7TH INT','CHILDREN','FAMILIA','JUNIORS 3','JUNIORS 4','KIDS 1','KIDS 2','KIDS 3','PLAY 2','PLY1'];
  const insertCurso = db.prepare('INSERT OR IGNORE INTO cursos (nombre, activo) VALUES (?, 1)');
  cursos.forEach(c => insertCurso.run(c));

  const alumnosData = [
    ['CARABAJAL ANA PAULA','1ST INT','',76000,73000],
    ['MAURIN GIANA','1ST INT','',76000,73000],
    ['MARTINEZ CARBAJO IVAN','1ST INT','23282612984',76000,73000],
    ['NIEVA GUEMES MIA ISABELLA','1ST INT','',76000,73000],
    ['BENICIO BELEN','1ST INT','27258005762',76000,73000],
    ['CARI, NIRVANA','2ND YEAR','',55500,52500],
    ['DIAZ LOLA','2ND YEAR','27267806093',55500,52500],
    ['NUGHES, LEON','2ND YEAR','27306379599',55500,52500],
    ['TRONCOSO ALMA','1ST','27365805771',55500,52500],
    ['ALCALA, MATEO','5TH INT','',85500,81500],
    ['APAZA BORELLI, VERONICA','5TH INT','27258929123',85500,81500],
    ['GARCIA, NICOLE','5TH INT','27288309111',85500,81500],
    ['GUZMAN, INAKI','5TH INT','20271755946',85500,81500],
    ['LARA LUCIO','5TH INT','',85500,81500],
    ['LOPEZ BERRUEZO, PILAR','5TH INT','27288676793',85500,81500],
    ['RUSSO RADA, FRANCESCA','5TH INT','27282480781',85500,81500],
    ['MORALES BELLIDO ALVARO','5TH INT','',85500,81500],
    ['MARTINEZ RUIZ BAUTISTA','5TH INT','',85500,81500],
    ['ALTOBELLI, ANA','6TH INT','27115395063',85500,81500],
    ['MARTINEZ ARGANARAZ ARIEL','6TH INT','20258023685',85500,81500],
    ['LOPEZ GARCIA VALENTINA','6TH INT','',85500,81500],
    ['CARDENAS, ARACELI','6TH INT','20348469127',85500,81500],
    ['MORALES, JUANA','6TH INT','27295951015',85500,81500],
    ['MORALES, LAUTARO','6TH INT','',85500,73000],
    ['VILLARREAL, MELANIE','6TH INT','',85500,81500],
    ['VERCELLINO IGNACIO','6TH INT','',85500,81500],
    ['PALACIOS ERNESTINA','6TH INT','',85500,81500],
    ['CASAS, GUILLERMINA','7TH INT','23364482299',87000,82500],
    ['DIAZ TORRES, JOSEFINA','7TH INT','27248759653',87000,82500],
    ['LOPEZ, AGNES','7TH INT','27312280855',87000,82500],
    ['MICOL, FRANCISCO','7TH INT','',87000,82500],
    ['VITALE GUADALUPE','7TH INT','20254376699',87000,82500],
    ['CAMACHO AMPARO','CHILDREN','',42500,40500],
    ['CANABIDES, ALLEGRA','CHILDREN','27407097608',42500,40500],
    ['FERNANDEZ AMARELIS','CHILDREN','27311264538',42500,40500],
    ['LUNA, SANTINO','CHILDREN','',42500,40500],
    ['NUNEZ, ALEXANDER','CHILDREN','27293369254',42500,40500],
    ['QUIROGA AMPARO','CHILDREN','20320624321',42500,40500],
    ['SOSA, SANTIAGO','CHILDREN','27303913721',42500,40500],
    ['TOLABA CARABAJAL KARLA ARIANA','CHILDREN','27316391236',42500,40500],
    ['ZARATE LUCIA','CHILDREN','27368022484',42500,40500],
    ['ALVAREZ LOURDES','CHILDREN','20364482729,27137473769',42500,36200],
    ['CABRERA AMADEO BENICIO','CHILDREN','',42500,36200],
    ['GUANCA PATRICIO MATIAS FEDERICO','CHILDREN','27418299822',42500,36200],
    ['CARRASCO, GAEL TIZIANO','CHILDREN','27376022752',42500,40500],
    ['FLIA AMADO RUSSO','FAMILIA','',171000,155500],
    ['FLIA BRITO','FAMILIA','27267018788',144500,132500],
    ['FLIA COTINI','FAMILIA','27321621142',111000,100000],
    ['FLIA CAYO E Y RAFAELA','FAMILIA','20288773433',112000,101500],
    ['FLIA CAYO A Y TAIEL','FAMILIA','27254603614',146000,133500],
    ['FLIA DIAZ MORALES','FAMILIA','23316390064',112000,95000],
    ['FLIA LACURI','FAMILIA','27296663080',95500,87000],
    ['FLIA MAMANI RUIZ','FAMILIA','27214634215',172500,156500],
    ['FLIA MARTINEZ','FAMILIA','',82000,75500],
    ['FLIA MOYA','FAMILIA','27319484596',144500,132500],
    ['FLIA ORTEGA','FAMILIA','',133500,122500],
    ['FLIA RAMIREZ ORTUNO','FAMILIA','20248024918',101500,92500],
    ['FLIA RIVERO','FAMILIA','27319488230',144500,132500],
    ['FLIA ROSAS','FAMILIA','27282480021',197500,170200],
    ['FLIA RUANO','FAMILIA','',98000,89000],
    ['FLIA OLIVEIRA BEJARANO','FAMILIA','',129500,119000],
    ['FLIA SANTAFE','FAMILIA','',112000,101500],
    ['FLIA GITIAN','FAMILIA','20346167697',140000,128000],
    ['FLIA SARAVIA','FAMILIA','27282481516',138500,127000],
    ['FLIA SUAREZ','FAMILIA','27334286733',95500,87000],
    ['FLIA TACTAGI','FAMILIA','',144500,132500],
    ['FLIA TEJERINA','FAMILIA','27255163413',146000,133500],
    ['FLIA TOLABA','FAMILIA','27349603697',106000,96000],
    ['FLIA VACA MONASTEROLO','FAMILIA','27315574353',172500,156500],
    ['FLIA VERCELLINO R','FAMILIA','27301102025',95500,87000],
    ['FLIA VILLAFANE GUITIAN','FAMILIA','27374198683',112000,101500],
    ['FLIA LIENDRO','FAMILIA','27335819131',181000,167500],
    ['FLIA CARI','FAMILIA','',107000,97000],
    ['FLIA RIOS','FAMILIA','',145500,132500],
    ['FLIA MARTINEZ ISAIAS TOBIAS','FAMILIA','27385076342',58000,52500],
    ['FLIA GASPAR GUITIAN','FAMILIA','',141000,131500],
    ['FLIA FECCIA','FAMILIA','20346477408',101000,95700],
    ['FLIA RIOS THIAGO RUTH','FAMILIA','27368059000',138500,127000],
    ['FLIA CASIMIRO','FAMILIA','',129000,118500],
    ['ANTUNA MAITENA','JUNIORS 3','27292956849',59000,56000],
    ['CABRAL SIMON','JUNIORS 3','20303571990',59000,56000],
    ['CARDENAS, MAILEN','JUNIORS 3','',59000,56000],
    ['CRUZ, LUDMILA','JUNIORS 3','',59000,56000],
    ['GUANCA, YAHIR','JUNIORS 3','20310629171',59000,56000],
    ['SORIA LIENDRO, LIA','JUNIORS 3','',59000,56000],
    ['CRUZ, EMA ISABELLA','JUNIORS 3','',59000,56000],
    ['ROJAS, JAZMIN','JUNIORS 3','27291201879',59000,56000],
    ['REALES, LAUTARO','JUNIORS 3','27268670713',59000,56000],
    ['SEGURA, VICTORIA','JUNIORS 3','23365052794',59000,56000],
    ['SOTILLO CATALINA','JUNIORS 3','27343488276,27177350988',59000,56000],
    ['YAPURA, BAUTISTA','JUNIORS 3','27363389053',59000,50000],
    ['ROBLEDO MAXIMO','JUNIORS 3','27274659500',59000,56000],
    ['LAIME, DAIANA','JUNIORS 4','27364483479',59000,56000],
    ['ORELLANA, ORIANA','JUNIORS 4','',59000,56000],
    ['RICCO, TIZIANO','JUNIORS 4','27318028066',59000,56000],
    ['RODRIGUEZ, GENESIS','JUNIORS 4','',59000,56000],
    ['TOLABA, JEREMIAS','JUNIORS 4','23292955154',59000,56000],
    ['ALCALA BAUTISTA','JUNIORS 4','20341849560',59000,50000],
    ['MOLINA GUADALUPE','JUNIORS 4','',59000,50000],
    ['CARRASCO, MATEO','KIDS 1','27297913927',48000,45500],
    ['CESPEDES PUPPI, JUAN EMILIO','KIDS 1','27244539683',48000,45500],
    ['CHOQUE JESUS GABRIEL','KIDS 1','',48000,45500],
    ['GARCIA CARBAJAL, VALENTINO GABRIEL','KIDS 1','',48000,45500],
    ['FLORES LUCAS','KIDS 1','',48000,45500],
    ['GERON CARMEN','KIDS 1','20367917238',48000,45500],
    ['GUTIERREZ, EMMA','KIDS 1','27339705335',48000,45500],
    ['MONTES, LOLA','KIDS 1','27316391112',48000,45500],
    ['PARRILLA, VALENTINA','KIDS 1','',48000,45500],
    ['POSADAS, JEREMIAS','KIDS 1','',48000,45500],
    ['RIVERO, AGUSTIN','KIDS 1','',48000,45500],
    ['SANGUEZO MIRANDA, LUZ','KIDS 1','27365365747',48000,45500],
    ['TERCERO, MATEO','KIDS 1','',48000,45500],
    ['VEDIA, FELIPE','KIDS 1','',48000,45500],
    ['VELA, NAHIARA','KIDS 1','23405161184',48000,45500],
    ['ZARATE FRANCESCA','KIDS 1','',48000,45500],
    ['NERI SALVADOR','KIDS 1','27332356877',48000,45500],
    ['CARMEN GUILLERMINA','KIDS 1','',48000,45500],
    ['ABALOS, AYLEN','KIDS 3','',53000,50500],
    ['ACOSTA MIA','KIDS 2','20313357563',53000,50500],
    ['AGUILERA, MIA','KIDS 2','',53000,50500],
    ['ANTONELLI, DONATO','KIDS 2','27328042105',53000,50500],
    ['CAMPOS GIOVANI','KIDS 2','',53000,50500],
    ['CASTRO, AGUSTIN','KIDS 2','27335929883',53000,50500],
    ['GOMEZ, NAZARENO','KIDS 2','27252624207',53000,50500],
    ['GUTIERREZ, ZOEMI','KIDS 2','27335929441',53000,45000],
    ['PERALES, MARIA CECILIA','KIDS 2','27306922187',53000,50500],
    ['PERCINO, NAHIARA','KIDS 2','',53000,50500],
    ['TOLABA, ESTEFANIA','KIDS 2','20270840419',53000,50500],
    ['TOMASINI AGUSTIN','KIDS 2','27285994786',53000,50500],
    ['YURKINA, MISAEL','KIDS 2','27310629516',53000,45000],
    ['VARGAS THIAGO','KIDS 2','27350272769',53000,50500],
    ['TAGLIOLI ANA','KIDS 2','20250786728',53000,50500],
    ['VILCA ESPERANZA','KIDS 2','',53000,50500],
    ['FACCHIN, OLIVIA','KIDS 3','27339704258',53000,50500],
    ['LOPEZ ESTEFANIA','KIDS 3','27377456756',53000,45000],
    ['MANSILLA, ABRIL','KIDS 3','',53000,50500],
    ['MONDAQUE SABRINA','KIDS 3','',53000,50500],
    ['REMENTERIA ISABEL','KIDS 3','20259313172',53000,50500],
    ['MOSA, TADEO','KIDS 3','24276610933',53000,50500],
    ['OROZCO, LAUTARO','KIDS 3','27285769634',53000,50500],
    ['ORTEGA MARCOS','KIDS 3','',53000,50500],
    ['VILLANUEVA CARLOS','KIDS 3','27316392135',53000,50500],
    ['GUAYMAS ZERPA, CIRO','KIDS 3','27279737615',53000,45000],
    ['CABELLO ALMA','KIDS 3','20361302975',53000,45000],
    ['FIRME TIZIANO','KIDS 3','27253759432',53000,45000],
    ['CHAVEZ DI PAULI CATALINA','PLAY 2','20445017478',29000,27500],
    ['MAMANI, FELICITAS','PLAY 2','27288676769',29000,27500],
    ['ALANCAY DEMIR','PLAY 2','',29000,27500],
    ['RAMPULLA, GINO','PLAY 2','27340666378',29000,27500],
    ['ZERPA, MATHEO','PLAY 2','27392176336',29000,24700],
    ['APARICIO ROYANO NAHYARA','PLAY 2','27304026672',29000,27500],
    ['VILTE PAZ LORENA SOL','PLAY 2','',29000,27500],
    ['CORONEL LAUTARO','PLY1','27390380335',29000,27500],
    ['VILLANUEVA FRANCISCO','PLY1','27448181729',29000,27500]
  ];

  const insertAlumno = db.prepare('INSERT INTO alumnos (nombre, curso, cuits, precio_normal, precio_bonificado) VALUES (?, ?, ?, ?, ?)');
  alumnosData.forEach(a => insertAlumno.run(...a));

  // Generar cuotas pendientes según mes actual
  const hoy = new Date();
  const mesActual = hoy.getMonth(); // 0=enero, Marzo=2
  const mesesIdx = [2,3,4,5,6,7,8,9,10,11]; // Marzo a Diciembre
  const alumnos = db.prepare('SELECT id FROM alumnos').all();
  const insertCuota = db.prepare('INSERT OR IGNORE INTO cuotas (alumno_id, numero_cuota, estado) VALUES (?, ?, ?)');

  // Pagos históricos: cuotas 1,2,3
  const pagosHist = [
    {id:1,c:[true,true,false]},{id:2,c:[true,true,false]},{id:3,c:[true,true,false]},
    {id:4,c:[true,false,false]},{id:5,c:[true,true,true]},{id:6,c:[false,false,true]},
    {id:7,c:[true,true,true]},{id:8,c:[true,true,true]},{id:9,c:[true,true,false]},
    {id:10,c:[false,false,false]},{id:11,c:[true,true,true]},{id:12,c:[true,true,true]},
    {id:13,c:[false,true,true]},{id:14,c:[true,true,false]},{id:15,c:[true,true,true]},
    {id:16,c:[true,true,true]},{id:17,c:[true,true,true]},{id:18,c:[true,true,true]},
    {id:19,c:[true,true,true]},{id:20,c:[false,true,false]},{id:21,c:[false,false,false]},
    {id:22,c:[true,true,true]},{id:23,c:[true,true,true]},{id:24,c:[true,true,false]},
    {id:25,c:[true,true,true]},{id:26,c:[true,false,false]},{id:27,c:[true,true,true]},
    {id:28,c:[true,true,true]},{id:29,c:[true,true,false]},{id:30,c:[true,true,false]},
    {id:31,c:[false,false,false]},{id:32,c:[true,true,true]},{id:33,c:[true,true,false]},
    {id:34,c:[true,true,true]},{id:35,c:[false,true,true]},{id:36,c:[true,true,false]},
    {id:37,c:[true,true,true]},{id:38,c:[true,true,true]},{id:39,c:[true,true,true]},
    {id:40,c:[true,true,true]},{id:41,c:[true,true,true]},{id:42,c:[true,true,true]},
    {id:43,c:[true,true,false]},{id:44,c:[true,true,false]},{id:45,c:[true,true,false]},
    {id:46,c:[true,true,false]},{id:47,c:[true,true,true]},{id:48,c:[true,true,false]},
    {id:49,c:[true,true,true]},{id:50,c:[true,true,false]},{id:51,c:[true,true,false]},
    {id:52,c:[true,true,false]},{id:53,c:[true,true,false]},{id:54,c:[true,true,false]},
    {id:55,c:[false,true,false]},{id:56,c:[false,false,false]},{id:57,c:[true,true,true]},
    {id:58,c:[true,true,false]},{id:59,c:[true,true,true]},{id:60,c:[true,true,true]},
    {id:61,c:[false,true,true]},{id:62,c:[true,true,true]},{id:63,c:[true,true,true]},
    {id:64,c:[true,true,true]},{id:65,c:[true,true,true]},{id:66,c:[true,true,true]},
    {id:67,c:[true,true,true]},{id:68,c:[false,true,true]},{id:69,c:[true,true,true]},
    {id:70,c:[true,true,true]},{id:71,c:[true,true,true]},{id:72,c:[true,true,true]},
    {id:73,c:[true,true,false]},{id:74,c:[true,true,false]},{id:75,c:[true,true,true]},
    {id:76,c:[false,false,false]},{id:77,c:[true,true,true]},{id:78,c:[true,true,false]},
    {id:79,c:[true,true,false]},{id:80,c:[true,true,true]},{id:81,c:[true,true,true]},
    {id:82,c:[false,false,false]},{id:83,c:[false,false,false]},{id:84,c:[true,true,false]},
    {id:85,c:[true,true,true]},{id:86,c:[true,true,false]},{id:87,c:[false,true,true]},
    {id:88,c:[true,true,false]},{id:89,c:[true,true,false]},{id:90,c:[true,true,false]},
    {id:91,c:[true,true,true]},{id:92,c:[true,true,true]},{id:93,c:[true,true,true]},
    {id:94,c:[true,true,true]},{id:95,c:[true,true,true]},{id:96,c:[true,true,true]},
    {id:97,c:[true,true,true]},{id:98,c:[true,true,true]},{id:99,c:[false,false,false]},
    {id:100,c:[true,true,true]},{id:101,c:[true,true,true]},{id:102,c:[true,true,false]},
    {id:103,c:[true,false,false]},{id:104,c:[true,true,true]},{id:105,c:[false,true,false]},
    {id:106,c:[true,true,true]},{id:107,c:[true,true,true]},{id:108,c:[true,true,true]},
    {id:109,c:[true,true,true]},{id:110,c:[true,true,false]},{id:111,c:[true,true,true]},
    {id:112,c:[true,false,false]},{id:113,c:[true,true,true]},{id:114,c:[true,true,false]},
    {id:115,c:[true,true,false]},{id:116,c:[true,true,false]},{id:117,c:[true,true,false]},
    {id:118,c:[true,false,true]},{id:119,c:[true,true,true]},{id:120,c:[true,true,false]},
    {id:121,c:[true,true,false]},{id:122,c:[false,false,false]},{id:123,c:[true,true,false]},
    {id:124,c:[true,true,true]},{id:125,c:[true,true,true]},{id:126,c:[true,true,false]},
    {id:127,c:[true,true,true]},{id:128,c:[false,true,false]},{id:129,c:[true,true,true]},
    {id:130,c:[true,true,true]},{id:131,c:[false,true,false]},{id:132,c:[true,true,true]},
    {id:133,c:[true,true,true]},{id:134,c:[true,true,true]},{id:135,c:[true,true,false]},
    {id:136,c:[true,true,false]},{id:137,c:[true,true,true]},{id:138,c:[true,true,true]},
    {id:139,c:[true,true,true]},{id:140,c:[true,true,true]},{id:141,c:[true,false,false]},
    {id:142,c:[true,true,true]},{id:143,c:[true,true,true]},{id:144,c:[false,true,true]},
    {id:145,c:[true,true,true]},{id:146,c:[true,true,true]},{id:147,c:[true,true,false]},
    {id:148,c:[false,true,false]},{id:149,c:[true,true,true]},{id:150,c:[true,true,true]},
    {id:151,c:[true,true,true]},{id:152,c:[true,true,true]},{id:153,c:[true,true,true]},
    {id:154,c:[true,true,true]}
  ];

  pagosHist.forEach(p => {
    for (let n = 1; n <= 10; n++) {
      const mesIdx = mesesIdx[n-1];
      if (mesIdx <= mesActual) {
        let estado = 'pendiente';
        if (n <= 3 && p.c[n-1]) estado = 'pagada';
        insertCuota.run(p.id, n, estado);
      }
    }
  });

  db.prepare("INSERT INTO config (clave, valor) VALUES ('iniciado', '1')").run();
}

// ================================================================
// RUTAS API
// ================================================================

// Cursos
app.get('/api/cursos', (req, res) => {
  const cursos = db.prepare('SELECT * FROM cursos WHERE activo = 1 ORDER BY nombre').all();
  res.json(cursos);
});

app.post('/api/cursos', (req, res) => {
  const { nombre } = req.body;
  const r = db.prepare('INSERT INTO cursos (nombre) VALUES (?)').run(nombre.trim().toUpperCase());
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.delete('/api/cursos/:id', (req, res) => {
  db.prepare('UPDATE cursos SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Alumnos
app.get('/api/alumnos', (req, res) => {
  const alumnos = db.prepare('SELECT * FROM alumnos ORDER BY nombre').all();
  res.json(alumnos);
});

app.post('/api/alumnos', (req, res) => {
  const { nombre, curso, cuits, precio_normal, precio_bonificado } = req.body;
  const r = db.prepare('INSERT INTO alumnos (nombre, curso, cuits, precio_normal, precio_bonificado) VALUES (?, ?, ?, ?, ?)').run(nombre.trim().toUpperCase(), curso, cuits||'', precio_normal||0, precio_bonificado||0);
  generarCuotas(r.lastInsertRowid);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/alumnos/:id', (req, res) => {
  const { nombre, curso, cuits, precio_normal, precio_bonificado } = req.body;
  db.prepare('UPDATE alumnos SET nombre=?, curso=?, cuits=?, precio_normal=?, precio_bonificado=? WHERE id=?').run(nombre.trim().toUpperCase(), curso, cuits||'', precio_normal||0, precio_bonificado||0, req.params.id);
  res.json({ ok: true });
});

app.patch('/api/alumnos/:id/baja', (req, res) => {
  db.prepare('UPDATE alumnos SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/alumnos/:id/alta', (req, res) => {
  db.prepare('UPDATE alumnos SET activo = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function generarCuotas(alumnoId) {
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const mesesIdx = [2,3,4,5,6,7,8,9,10,11];
  const insert = db.prepare('INSERT OR IGNORE INTO cuotas (alumno_id, numero_cuota, estado) VALUES (?, ?, ?)');
  mesesIdx.forEach((mi, i) => {
    if (mi <= mesActual) insert.run(alumnoId, i+1, 'pendiente');
  });
}

// Cuotas
app.get('/api/cuotas/:alumnoId', (req, res) => {
  const cuotas = db.prepare('SELECT * FROM cuotas WHERE alumno_id = ? ORDER BY numero_cuota').all(req.params.alumnoId);
  res.json(cuotas);
});

// Pagos
app.get('/api/pagos', (req, res) => {
  const pagos = db.prepare('SELECT * FROM pagos ORDER BY id DESC').all();
  res.json(pagos);
});

app.post('/api/cobro', (req, res) => {
  const { alumnoId, monto, medio, origen, cuotasSeleccionadas } = req.body;
  const alumno = db.prepare('SELECT * FROM alumnos WHERE id = ?').get(alumnoId);
  if (!alumno) return res.json({ ok: false, error: 'Alumno no encontrado' });

  const hoy = new Date();
  const dia = hoy.getDate();
  const fecha = hoy.toLocaleDateString('es-AR') + ' ' + hoy.toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit'});
  const MESES_TODO_EL_MES = [1, 5];

  // Verificar si cuota 10 es gratis: cuotas 1-9 todas pagadas con precio bonificado
  function cuota10Gratis() {
    const cuotasAlumno = db.prepare('SELECT * FROM cuotas WHERE alumno_id = ? AND numero_cuota <= 9').all(alumnoId);
    if (cuotasAlumno.length < 9) return false;
    // Todas las cuotas 1-9 deben estar pagadas
    const todasPagadas = cuotasAlumno.every(c => c.estado === 'pagada');
    if (!todasPagadas) return false;
    // Verificar que cada cuota fue pagada con precio bonificado
    // (monto_pagado <= precio_bonificado del alumno, o fue pagada en mes con bonificación)
    return cuotasAlumno.every(c => {
      const num = c.numero_cuota;
      // Cuotas 1 y 5 siempre son bonificadas (todo el mes)
      if (MESES_TODO_EL_MES.includes(num)) return true;
      // Las demás: el monto pagado debe ser <= precio_bonificado
      return c.monto_pagado <= alumno.precio_bonificado || c.monto_pagado === 0;
    });
  }

  function getPrecio(numCuota) {
    if (numCuota === 10 && cuota10Gratis()) return 0;
    const esBonif = MESES_TODO_EL_MES.includes(numCuota) || dia <= 10;
    return esBonif ? alumno.precio_bonificado : alumno.precio_normal;
  }

  const cuotasCubiertas = [];
  const conceptos = [];

  if (cuotasSeleccionadas && cuotasSeleccionadas.length > 0) {
    const MESES_NOMBRE = ['Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    cuotasSeleccionadas.forEach(numC => {
      const precio = getPrecio(numC);
      cuotasCubiertas.push({ num: numC, monto: precio });
      const etiqueta = precio === 0 ? ` (GRATIS - bonificacion cumplida)` : '';
      conceptos.push(`Cuota ${numC} (${MESES_NOMBRE[numC-1]} 2026)${etiqueta}`);
      db.prepare('UPDATE cuotas SET estado=?, fecha_pago=?, monto_pagado=? WHERE alumno_id=? AND numero_cuota=?').run('pagada', fecha, precio, alumnoId, numC);
    });
  }

  const r = db.prepare('INSERT INTO pagos (fecha, alumno_id, alumno_nombre, curso, monto, concepto, medio, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(fecha, alumnoId, alumno.nombre, alumno.curso, monto, conceptos.join(', '), medio, origen);

  res.json({ ok: true, pagoId: r.lastInsertRowid, fecha, conceptos });
});

// Importación bancaria
app.post('/api/banco', (req, res) => {
  const { filas, colCuit, colMonto } = req.body;
  const alumnos = db.prepare('SELECT * FROM alumnos WHERE activo = 1').all();

  // Construir mapa CUIT -> alumno
  const cuitMap = {};
  alumnos.forEach(a => {
    if (a.cuits) {
      a.cuits.split(',').forEach(c => {
        const clean = c.trim().replace(/[^0-9]/g, '');
        if (clean.length === 11) cuitMap[clean] = a;
      });
    }
  });

  let aplicados = 0;
  const noEncontrados = [];
  const MESES_NOMBRE = ['Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const MESES_TODO_EL_MES = [1, 5];
  const hoy = new Date();
  const dia = hoy.getDate();
  const fecha = hoy.toLocaleDateString('es-AR');

  filas.forEach(fila => {
    const cuit = extraerCuit(fila[colCuit]);
    const monto = parseFloat(String(fila[colMonto]).replace(',', '.')) || 0;
    if (!cuit || monto <= 0) return;

    const alumno = cuitMap[cuit];
    if (!alumno) { noEncontrados.push({ cuit, monto, detalle: String(fila[colCuit]).slice(0, 50) }); return; }

    // Aplicar a cuotas pendientes
    let restante = monto;
    const pendientes = db.prepare('SELECT * FROM cuotas WHERE alumno_id = ? AND estado = ? ORDER BY numero_cuota').all(alumno.id, 'pendiente');
    const conceptos = [];

    for (const c of pendientes) {
      if (restante <= 0) break;
      // Cuota 10 gratis si cuotas 1-9 todas pagadas con bonificado
      let precio = 0;
      if (c.numero_cuota === 10) {
        const ant = db.prepare('SELECT * FROM cuotas WHERE alumno_id = ? AND numero_cuota <= 9').all(alumno.id);
        const todasPagBonif = ant.length === 9 && ant.every(q => q.estado === 'pagada' && (MESES_TODO_EL_MES.includes(q.numero_cuota) || q.monto_pagado <= alumno.precio_bonificado));
        precio = todasPagBonif ? 0 : (dia <= 10 ? alumno.precio_bonificado : alumno.precio_normal);
      } else {
        const esBonifC = MESES_TODO_EL_MES.includes(c.numero_cuota) || dia <= 10;
        precio = esBonifC ? alumno.precio_bonificado : alumno.precio_normal;
      }
      if (restante >= precio) {
        db.prepare('UPDATE cuotas SET estado=?, fecha_pago=?, monto_pagado=? WHERE id=?').run('pagada', fecha, precio, c.id);
        conceptos.push(`Cuota ${c.numero_cuota} (${MESES_NOMBRE[c.numero_cuota-1]} 2026)`);
        restante -= precio;
      }
    }

    db.prepare('INSERT INTO pagos (fecha, alumno_id, alumno_nombre, curso, monto, concepto, medio, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(fecha, alumno.id, alumno.nombre, alumno.curso, monto, conceptos.join(', ') || 'Transferencia bancaria', 'Transferencia', `Banco (CUIT ${cuit})`);
    aplicados++;
  });

  res.json({ ok: true, aplicados, noEncontrados });
});

// Reporte
app.get('/api/reporte', (req, res) => {
  const alumnos = db.prepare('SELECT * FROM alumnos WHERE activo = 1 ORDER BY nombre').all();
  const MESES_NOMBRE = ['Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const MESES_IDX = [2,3,4,5,6,7,8,9,10,11];
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const dia = hoy.getDate();
  const MESES_TODO_EL_MES = [1, 5];

  const resultado = alumnos.map(a => {
    const cuotas = db.prepare('SELECT * FROM cuotas WHERE alumno_id = ? ORDER BY numero_cuota').all(a.id);
    const pagos = db.prepare('SELECT SUM(monto) as total FROM pagos WHERE alumno_id = ?').get(a.id);
    const totalPagado = pagos?.total || 0;

    const estadoCuotas = {};
    for (let i = 0; i < 10; i++) {
      const numC = i + 1;
      const mesIdx = MESES_IDX[i];
      if (mesIdx > mesActual) { estadoCuotas[numC] = 'futura'; continue; }
      const cuota = cuotas.find(c => c.numero_cuota === numC);
      if (!cuota) { estadoCuotas[numC] = 'pendiente'; continue; }
      estadoCuotas[numC] = cuota.estado === 'pagada' ? (cuota.compensada ? 'compensada' : 'pagada') : 'pendiente';
    }

    // Calcular saldo neto y compensar visualmente
    const cuotasGen = Object.entries(estadoCuotas).filter(([,v]) => v !== 'futura');

    // Verificar si cuota 10 es gratis
    const cuotas19 = cuotas.filter(c => c.numero_cuota <= 9);
    const cuota10Gratis = cuotas19.length === 9 &&
      cuotas19.every(c => c.estado === 'pagada' &&
        (MESES_TODO_EL_MES.includes(c.numero_cuota) || c.monto_pagado <= a.precio_bonificado));

    const getPrecioRep = (numC) => {
      if (numC === 10 && cuota10Gratis) return 0;
      const eb = MESES_TODO_EL_MES.includes(numC) || dia <= 10;
      return eb ? a.precio_bonificado : a.precio_normal;
    };

    // Marcar cuota 10 como 'gratis' si corresponde y está pendiente
    if (cuota10Gratis && estadoCuotas[10] === 'pendiente') {
      estadoCuotas[10] = 'gratis';
    }

    const totalDebido = cuotasGen.reduce((s, [k]) => s + getPrecioRep(parseInt(k)), 0);
    let saldoNeto = totalPagado - totalDebido;

    if (saldoNeto > 0) {
      let disponible = saldoNeto;
      for (let i = 0; i < 10; i++) {
        const numC = i + 1;
        if (estadoCuotas[numC] === 'pendiente' && disponible > 0) {
          const precio = getPrecioRep(numC);
          if (precio > 0 && disponible >= precio) {
            estadoCuotas[numC] = 'compensada';
            disponible -= precio;
          }
        }
      }
    }

    const deudaReal = Object.entries(estadoCuotas).reduce((s, [k, v]) => {
      if (v !== 'pendiente') return s;
      return s + getPrecioRep(parseInt(k));
    }, 0);

    return { id: a.id, nombre: a.nombre, curso: a.curso, precio_normal: a.precio_normal, precio_bonificado: a.precio_bonificado, cuits: a.cuits, activo: a.activo, estadoCuotas, deudaReal, totalPagado, cuota10Gratis };
  });

  res.json(resultado);
});

function extraerCuit(texto) {
  if (!texto) return null;
  const partes = String(texto).split('/');
  for (const p of partes) {
    const clean = p.trim().replace(/-/g, '').replace(/\s/g, '');
    if (/^\d{11}$/.test(clean)) return clean;
  }
  return null;
}

// Aranceles
app.get('/api/aranceles', (req, res) => {
  const aranceles = db.prepare('SELECT * FROM aranceles ORDER BY desde DESC').all();
  res.json(aranceles);
});

app.post('/api/aranceles', (req, res) => {
  const { desde, descripcion } = req.body;
  const creado = new Date().toISOString();
  const r = db.prepare('INSERT INTO aranceles (desde, descripcion, creado) VALUES (?, ?, ?)').run(desde, descripcion || '', creado);
  const id = r.lastInsertRowid;
  // Copiar precios actuales de todos los alumnos
  const alumnos = db.prepare('SELECT * FROM alumnos').all();
  const ins = db.prepare('INSERT INTO aranceles_precios (arancel_id, alumno_id, precio_normal, precio_bonificado) VALUES (?, ?, ?, ?)');
  alumnos.forEach(a => ins.run(id, a.id, a.precio_normal, a.precio_bonificado));
  res.json({ ok: true, id });
});

app.get('/api/aranceles/:id/precios', (req, res) => {
  const precios = db.prepare(`
    SELECT ap.*, a.nombre, a.curso 
    FROM aranceles_precios ap
    JOIN alumnos a ON ap.alumno_id = a.id
    WHERE ap.arancel_id = ?
    ORDER BY a.nombre
  `).all(req.params.id);
  res.json(precios);
});

app.put('/api/aranceles/:id/precios', (req, res) => {
  const { precios } = req.body; // [{alumno_id, precio_normal, precio_bonificado}]
  const hoy = new Date().toISOString().slice(0,10);
  const arancel = db.prepare('SELECT * FROM aranceles WHERE id = ?').get(req.params.id);
  const upd = db.prepare('UPDATE aranceles_precios SET precio_normal=?, precio_bonificado=? WHERE arancel_id=? AND alumno_id=?');
  const updAlumno = db.prepare('UPDATE alumnos SET precio_normal=?, precio_bonificado=? WHERE id=?');
  precios.forEach(p => {
    upd.run(p.precio_normal, p.precio_bonificado, req.params.id, p.alumno_id);
    // Si la vigencia es activa (desde <= hoy), actualizar precio del alumno
    if (arancel && arancel.desde <= hoy) {
      updAlumno.run(p.precio_normal, p.precio_bonificado, p.alumno_id);
    }
  });
  res.json({ ok: true });
});

app.delete('/api/aranceles/:id', (req, res) => {
  db.prepare('DELETE FROM aranceles_precios WHERE arancel_id = ?').run(req.params.id);
  db.prepare('DELETE FROM aranceles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Exportar pagos como JSON (el Excel lo genera el frontend)
app.get('/api/exportar/pagos', (req, res) => {
  const pagos = db.prepare('SELECT * FROM pagos ORDER BY id').all();
  res.json(pagos);
});

// Servir frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
