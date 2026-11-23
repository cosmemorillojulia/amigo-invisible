// Tests del algoritmo del sorteo (js/sorteo.js). Ejecutar con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Sorteo = require('../js/sorteo.js');

const NOMBRES = ['Ana', 'Bruno', 'Carla', 'David', 'Elena', 'Fran', 'Gema', 'Hugo'];

function comprobarReparto(asignaciones, nombres, exclusiones = [], evitarReciprocos = false) {
  assert.deepEqual(Object.keys(asignaciones).sort(), [...nombres].sort(), 'todos regalan');
  assert.deepEqual(Object.values(asignaciones).sort(), [...nombres].sort(), 'todos reciben exactamente una vez');
  for (const [da, recibe] of Object.entries(asignaciones)) {
    assert.notEqual(da, recibe, `${da} no puede regalarse a sí mismo`);
    if (evitarReciprocos) assert.notEqual(asignaciones[recibe], da, `${da} y ${recibe} no deben regalarse mutuamente`);
  }
  for (const [a, b] of exclusiones) {
    assert.notEqual(asignaciones[a], b, `${a} no puede regalar a ${b}`);
    assert.notEqual(asignaciones[b], a, `${b} no puede regalar a ${a}`);
  }
}

test('reparto válido sin exclusiones', () => {
  for (let i = 0; i < 300; i++) comprobarReparto(Sorteo.sortear(NOMBRES, []), NOMBRES);
});

test('respeta las exclusiones mutuas', () => {
  const ex = [['Ana', 'Bruno'], ['Carla', 'David'], ['Elena', 'Ana']];
  for (let i = 0; i < 300; i++) comprobarReparto(Sorteo.sortear(NOMBRES, ex), NOMBRES, ex);
});

test('las exclusiones no distinguen mayúsculas ni espacios', () => {
  const ex = [[' ana ', 'BRUNO']];
  for (let i = 0; i < 100; i++) comprobarReparto(Sorteo.sortear(NOMBRES, ex), NOMBRES, [['Ana', 'Bruno']]);
});

test('evita intercambios cruzados si se pide', () => {
  for (const n of [3, 4, 5, 8]) {
    const nombres = NOMBRES.slice(0, n);
    for (let i = 0; i < 200; i++) comprobarReparto(Sorteo.sortear(nombres, [], { evitarReciprocos: true }), nombres, [], true);
  }
});

test('funciona con 2 participantes', () => {
  assert.deepEqual(Sorteo.sortear(['Ana', 'Bruno'], []), { Ana: 'Bruno', Bruno: 'Ana' });
});

test('detecta sorteos imposibles', () => {
  assert.equal(Sorteo.comprobar(['Ana'], []).posible, false);
  assert.equal(Sorteo.comprobar(['Ana', 'Bruno'], [['Ana', 'Bruno']]).posible, false);
  assert.equal(Sorteo.comprobar(['Ana', 'Bruno'], [], { evitarReciprocos: true }).posible, false);
  // Ana excluida con todos los demás
  const r = Sorteo.comprobar(['Ana', 'Bruno', 'Carla'], [['Ana', 'Bruno'], ['Ana', 'Carla']]);
  assert.equal(r.posible, false);
  assert.match(r.motivo, /Ana/);
  // 3 personas con una exclusión y sin cruces: solo quedan ciclos de 3, que usan todas las aristas
  assert.equal(Sorteo.comprobar(['Ana', 'Bruno', 'Carla'], [['Ana', 'Bruno']], { evitarReciprocos: true }).posible, false);
});

test('detecta nombres repetidos y exclusiones con desconocidos', () => {
  assert.equal(Sorteo.comprobar(['Ana', 'ana', 'Bruno'], []).codigo, 'DUPLICADO');
  assert.equal(Sorteo.comprobar(['Ana', 'Bruno', 'Carla'], [['Ana', 'Zoe']]).codigo, 'EXCLUSION');
});

test('casos muy restringidos pero posibles se resuelven', () => {
  // Cada uno solo puede regalar al siguiente (ciclo forzado)
  const nombres = ['A', 'B', 'C', 'D', 'E', 'F'];
  const ex = [];
  for (let i = 0; i < nombres.length; i++) {
    for (let j = i + 1; j < nombres.length; j++) {
      const consecutivos = j === i + 1 || (i === 0 && j === nombres.length - 1);
      if (!consecutivos) ex.push([nombres[i], nombres[j]]);
    }
  }
  for (let i = 0; i < 20; i++) comprobarReparto(Sorteo.sortear(nombres, ex), nombres, ex);
});

test('todos los repartos posibles salen con frecuencia parecida', () => {
  // Con 4 personas hay 9 desarreglos posibles
  const nombres = ['A', 'B', 'C', 'D'];
  const conteo = new Map();
  const rondas = 9000;
  for (let i = 0; i < rondas; i++) {
    const reparto = Sorteo.sortear(nombres, []);
    const clave = nombres.map(n => reparto[n]).join('');
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
  }
  assert.equal(conteo.size, 9);
  for (const veces of conteo.values()) assert.ok(veces > 700 && veces < 1300, `frecuencia sesgada: ${veces}`);
});
