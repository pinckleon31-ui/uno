'use strict';

// Point d'entrée serverless de Vercel.
//
// Toutes les routes /api/… arrivent ici grâce à la règle `rewrites` de
// vercel.json, et sont traitées par exactement le même serveur Node que sur un
// VPS, à ceci près qu'aucun port n'est ouvert : Vercel appelle `handler` à
// chaque requête.
module.exports = require('../server.js').handler;
