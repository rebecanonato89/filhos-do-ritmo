// Dados de EXEMPLO para testar o portal antes das cartinhas reais.
//   node scripts/demo.mjs seed   -> cria 10 crianças fictícias (Turma Exemplo A/B)
//   node scripts/demo.mjs clear  -> apaga só elas (fotos demo-*), sem tocar nas reais
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertChild, deleteDemoChildren } from '../src/db.mjs';

// Espelham as imagens em demo/photos (mesmo nome, idade, pedidos e tamanhos).
const DEMO = [
  ['Turma Exemplo A', 'Ana Clara', 'ana-clara', '8', 'Boneca que fala', 'Kit de pintura', 'Cesta de guloseimas', '8', '8', '30'],
  ['Turma Exemplo A', 'Bernardo', 'bernardo', '10', 'Bicicleta aro 20', 'Bola de futebol', 'Chuteira', '10', '10', '33'],
  ['Turma Exemplo A', 'Camila', 'camila', '11', 'Kit de maquiagem', 'Mochila', 'Estojo completo', '12', '12', '34'],
  ['Turma Exemplo A', 'Davi', 'davi', '6', 'Carrinho controle remoto', 'Lego', 'Pijama', '6', '6', '28'],
  ['Turma Exemplo A', 'Eloá', 'eloa', '7', 'Patinete', 'Livro de histórias', 'Tênis de luz', '8', '8', '29'],
  ['Turma Exemplo B', 'Gabriel', 'gabriel', '13', 'Tablet', 'Fone de ouvido', 'Mochila', '14', '14', '38'],
  ['Turma Exemplo B', 'Helena', 'helena', '12', 'Caixa de som', 'Kit de pulseiras', 'Sandália', '12', '12', '35'],
  ['Turma Exemplo B', 'Isaac', 'isaac', '14', 'Videogame portátil', 'Camisa de time', 'Boné', '16', '16', '40'],
  ['Turma Exemplo B', 'Júlia', 'julia', '13', 'Fone sem fio', 'Agenda e canetas', 'Perfume infantil', '14', '14', '36'],
  ['Turma Exemplo B', 'Lucas', 'lucas', '12', 'Skate', 'Kit de futebol', 'Cesta de chocolates', '12', '14', '37'],
];

const dataDir = process.env.DATA_DIR || './data';
const photosDir = join(dataDir, 'photos');
const sourceDir = new URL('../demo/photos/', import.meta.url).pathname;
const db = openDb(join(dataDir, 'app.db'));
const action = process.argv[2];

if (action === 'seed') {
  mkdirSync(photosDir, { recursive: true });
  for (const [class_name, name, slug, age, gift_1, gift_2, gift_3, shirt_size, pants_size, shoe_size] of DEMO) {
    const photo = `demo-${slug}.jpg`;
    copyFileSync(join(sourceDir, photo), join(photosDir, photo));
    upsertChild(db, { class_name, name, photo, age, gift_1, gift_2, gift_3, shirt_size, pants_size, shoe_size });
  }
  console.log(`${DEMO.length} crianças de exemplo criadas.`);
} else if (action === 'clear') {
  const removed = deleteDemoChildren(db);
  for (const f of readdirSync(photosDir).filter((f) => f.startsWith('demo-'))) rmSync(join(photosDir, f));
  console.log(`${removed} crianças de exemplo removidas.`);
} else {
  console.error('Uso: node scripts/demo.mjs seed|clear');
  process.exit(1);
}
