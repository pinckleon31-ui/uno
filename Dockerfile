# Image de production de Récré’Jeux : un seul conteneur Node, aucune dépendance.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/.data

WORKDIR /app

# Toutes les sources utiles sont copiées ; .dockerignore exclut tests et données.
COPY . .

# Les salons, comptes et le journal vivent dans DATA_DIR : monte un volume ici.
RUN mkdir -p /app/.data && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
