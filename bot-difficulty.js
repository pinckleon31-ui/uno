'use strict';

// Niveau des bots de test, choisi par l'organisateur au moment de les ajouter.
// Chaque moteur lit `room.botDifficulty` et adapte son jeu :
//   facile   : les bots se trompent souvent, ils sont faciles à battre ;
//   normal   : le comportement historique, correct sans être imbattable ;
//   difficile: les bots jouent au mieux de leurs heuristiques.

const LEVELS = Object.freeze(['facile', 'normal', 'difficile']);
const LABELS = Object.freeze({
  facile: 'Facile',
  normal: 'Normal',
  difficile: 'Difficile',
});

// « normal » correspond au comportement historique des bots : aucune erreur
// volontaire, donc des parties reproductibles dans les tests.
const MISTAKE_CHANCE = Object.freeze({
  facile: 0.45,
  normal: 0,
  difficile: 0,
});

// Chance qu'un bot connaisse la bonne réponse (quiz et blind test).
const KNOWLEDGE = Object.freeze({
  quiz: { facile: 0.35, normal: 0.62, difficile: 0.88 },
  'blind-test': { facile: 0.22, normal: 0.42, difficile: 0.7 },
});

function normalize(difficulty) {
  return LEVELS.includes(difficulty) ? difficulty : 'normal';
}

function mistakeChance(difficulty) {
  return MISTAKE_CHANCE[normalize(difficulty)];
}

function shouldBlunder(difficulty, random = Math.random) {
  return random() < mistakeChance(difficulty);
}

function knowledgeRate(kind, difficulty) {
  const table = KNOWLEDGE[kind] || KNOWLEDGE.quiz;
  return table[normalize(difficulty)];
}

function label(difficulty) {
  return LABELS[normalize(difficulty)];
}

// Choisit au hasard un élément d'une liste, sans jamais planter sur une liste vide.
function pickRandom(list, random = Math.random) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(random() * list.length)];
}

module.exports = {
  LEVELS,
  LABELS,
  normalize,
  mistakeChance,
  shouldBlunder,
  knowledgeRate,
  label,
  pickRandom,
};
