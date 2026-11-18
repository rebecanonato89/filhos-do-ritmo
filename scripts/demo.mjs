// Dados de EXEMPLO para testar o portal antes das cartinhas reais.
//   node scripts/demo.mjs seed   -> cria 10 crianças fictícias (Turma Exemplo A/B)
//   node scripts/demo.mjs clear  -> apaga só elas (fotos demo-*), sem tocar nas reais
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertChild, deleteDemoChildren } from '../src/db.mjs';

const DEMO = [
  ['Turma Exemplo A', 'Ana Clara', 'ana-clara', 'Boneca que fala', 'Kit de pintura', 'Cesta de guloseimas', '8', '8', '30',
    'Querido Papai Noel, eu me comportei muito esse ano e ajudei minha mãe em casa. Meu sonho é uma boneca que fala. Obrigada!'],
  ['Turma Exemplo A', 'Bernardo', 'bernardo', 'Bicicleta aro 20', 'Bola de futebol', 'Chuteira', '10', '10', '33',
    'Oi padrinho! Eu adoro jogar bola com meus amigos na quadra do projeto. Se puder, queria uma bicicleta para ir pra escola.'],
  ['Turma Exemplo A', 'Camila', 'camila', 'Kit de maquiagem infantil', 'Mochila', 'Estojo completo', '12', '12', '34',
    'Eu gosto muito de desenhar e de música. Esse ano aprendi a tocar tambor no Filhos do Ritmo!'],
  ['Turma Exemplo A', 'Davi', 'davi', 'Carrinho de controle remoto', 'Lego', 'Pijama', '6', '6', '28',
    'Papai Noel, eu tenho 6 anos e gosto de carrinho. Beijos do Davi.'],
  ['Turma Exemplo A', 'Eloá', 'eloa', 'Patinete', 'Livro de histórias', 'Tênis', '8', '8', '29',
    'Eu amo ler historinhas antes de dormir. Quero muito um patinete pra brincar com minha irmã.'],
  ['Turma Exemplo B', 'Gabriel', 'gabriel', 'Tablet', 'Fone de ouvido', 'Mochila', '14', '14', '38',
    'Sei que o tablet é difícil, mas seria muito bom pra eu estudar. Qualquer presente vai me deixar feliz.'],
  ['Turma Exemplo B', 'Helena', 'helena', 'Caixa de som bluetooth', 'Kit de pulseiras', 'Sandália', '12', '12', '35',
    'Oi! Eu danço no projeto e queria uma caixinha de som pra ensaiar em casa. Feliz Natal!'],
  ['Turma Exemplo B', 'Isaac', 'isaac', 'Videogame portátil', 'Camisa de time', 'Boné', '16', '16', '40',
    'Meu time é o Galo. Se não der o videogame, a camisa do time já está ótimo. Valeu!'],
  ['Turma Exemplo B', 'Júlia', 'julia', 'Fone de ouvido sem fio', 'Agenda e canetas', 'Perfume infantil', '14', '14', '36',
    'Querido padrinho ou madrinha, obrigada por pensar em mim. Gosto de escrever e de ouvir música.'],
  ['Turma Exemplo B', 'Lucas', 'lucas', 'Skate', 'Kit de futebol', 'Cesta de chocolates', '12', '14', '37',
    'Eu quero aprender a andar de skate. Prometo usar capacete! Abraço do Lucas.'],
];

const dataDir = process.env.DATA_DIR || './data';
const photosDir = join(dataDir, 'photos');
const sourceDir = new URL('../demo/photos/', import.meta.url).pathname;
const db = openDb(join(dataDir, 'app.db'));
const action = process.argv[2];

if (action === 'seed') {
  mkdirSync(photosDir, { recursive: true });
  for (const [class_name, name, slug, gift_1, gift_2, gift_3, shirt_size, pants_size, shoe_size, letter] of DEMO) {
    const photo = `demo-${slug}.jpg`;
    copyFileSync(join(sourceDir, photo), join(photosDir, photo));
    upsertChild(db, { class_name, name, photo, gift_1, gift_2, gift_3, shirt_size, pants_size, shoe_size, letter });
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
