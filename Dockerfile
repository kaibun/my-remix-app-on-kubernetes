FROM node:18-alpine
LABEL maintainer="You Nameit <you@domain.tld>"
LABEL description="Runs a Remix app"
 
WORKDIR /usr/server/app
 
COPY ./package.json ./
RUN npm install
 
COPY ./ .
 
ENV NODE_ENV=production
ENV K8S_SERVER_PORT=80
ENV K8S_PROBES_PORT=9000
 
EXPOSE ${K8S_SERVER_PORT}
EXPOSE ${K8S_PROBES_PORT}
 
RUN npm run build
 
CMD ["npm", "run", "start"]