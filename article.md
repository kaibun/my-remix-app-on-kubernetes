---
date: 2023-02-25 10:21:26 +0100
title: Deploying Remix to Kubernetes
description: Using Helm to deploy a Remix (Express-based) app within a Kubernetes cluster.
tags: kubernetes, remix
type: techtip
published: true
---

import Link from "@mui/material/Link";

import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Typography from "@mui/material/Typography";

import { Deck, Slide } from "~/lib/components/PitchDeck/Textual";
import { Image } from "~/lib/components/Media";
import CodeTabs from "~/lib/components/CodeTabs";

import remixRuntimeReverseProxy from "~/assets/images/remix/remix-runtime-reverse-proxy.png";

Without an official documentation about deploying a Remix app to Kubernetes (k8s), this article will walk you through a simple setup for taking any _Express-based_ Remix app to production using Helm.

<Slide severity="info">
  Although we’ll cover Express-based apps only, _similar_ steps could be taken
  to handle other runtimes (any Node.js server as well as non-Node.js
  environments like Cloudflare Workers, Deno Deploy…). YMMV, though, depending
  on lib availability.
</Slide>

<Slide severity="warning" sx={{mt: 2}}>
  **TL;DR:**

- [Check the deployed app](https://my-remix-app.kaibun.net/)
- [Check the source code](https://github.com/kaibun/my-remix-app-on-kubernetes)

</Slide>

## Taking over Remix’s deployment target

**To properly deploy an app on Kubernetes, we’ll need to add specific logic to the runtime server of our Remix app.**

In particular, we must add [diagnostic probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#types-of-probe), which are _required_ to run a container within a Kubernetes’ pod (see [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) for more details).

By default, a brand-new Remix app’s backend runs as a built-in, production-ready application server known as the [Remix App Server](https://remix.run/docs/en/v1/other-api/serve). Unfortunately, that default server does not support Kubernetes; namely, it does not provide lifecycle/diagnosis probes.

Even worse, Remix App Server is merely a black box [we cannot extend](https://en.wikipedia.org/wiki/Open%E2%80%93closed_principle), as it’s called through the `remix-serve build` npm script.

<Slide severity="info">
  The Remix App Server concretely is [the Node.js
  implementation](https://github.com/remix-run/remix/tree/main/packages/remix-node)
  of the
  [@remix-run/server-runtime](https://www.npmjs.com/package/@remix-run/server-runtime)
  spec/abstract. Besides Node.js, one may also run a Remix app on Cloudflare and
  Deno, which are different runtimes with different constraints and tooling.
  <br />
  The Remix App Server is also referred to as the default "deployment target" in
  Remix verbiage. That target is to be chosen when you are not sure of your
  deployment service. But in our case, we know better: our deployment service is
  Kubernetes, and we’ll need to abide by a particular set of rules regarding how
  a Node.js containerized app (such as Remix) runs within Kubernetes.
</Slide>

<Image
  src={remixRuntimeReverseProxy}
  alt="Remix runtime similar to a reverse-proxy"
  sx={{
    maxWidth: "100%",
    objectFit: "contain",
    p: 2,
    mt: 2,
    borderRadius: 1,
  }}
/>

This setup is similar to that of a [reverse-proxy](https://en.wikipedia.org/wiki/Reverse_proxy), with the Remix server runtime "proxying" requests to and responses from the underlying Remix app.

Much like we could be swapping Apache with Nginx and gain different capabilities, we’d like to replace the default, _implicit_ Remix App Server with a more capable, _explicit_ Express server we could tweak in any way we see fit. Fortunately enough, it’s possible:

> […] you should set up your own [@remix-run/express](https://remix.run/docs/en/v1/other-api/adapter#createrequesthandler) server and a tool in development like pm2-dev or nodemon to restart the server on file changes instead. — [_remix.run/docs_](https://remix.run/docs/en/v1/other-api/serve)

The first concrete step to running Remix on Kubernetes is then to pick a different deployment target than the default _Remix App Server_. Let’s pick _Express Server_ instead:

{/* prettier-ignore */}
```txt /$ npx create-remix@latest/#gray /^?/#green "./my-remix-app"#blue /Just the basics/#blue /❯ Express Server/#blue
$ npx create-remix@latest
Need to install the following packages:
  create-remix@1.13.0
Ok to proceed? (y) y
? Where would you like to create your app? ./my-remix-app
? What type of app do you want to create? Just the basics
? Where do you want to deploy? Choose Remix App Server if you're unsure;
it's easy to change deployment targets.
  Remix App Server
❯ Express Server
  Architect (AWS Lambda)
  Fly.io
  Netlify
  Vercel
  Cloudflare Pages
```

## Injecting the k8s diagnostic probes

Once you pick any other target than _Remix App Server_, you’ll trigger the usage of a [server adapter](https://remix.run/docs/en/v1/other-api/adapter). Since we picked _Express Server_, Remix will leverage the @remix-run/express adapter and generate a server.js file at the root of the app:

```js showLineNumbers title="./server.js"
const path = require("path");
const express = require("express");
const compression = require("compression");
const morgan = require("morgan");
const { createRequestHandler } = require("@remix-run/express");

const BUILD_DIR = path.join(process.cwd(), "build");

const app = express();

app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

// Remix fingerprints its assets so we can cache forever.
app.use(
  "/build",
  express.static("public/build", { immutable: true, maxAge: "1y" })
);

// Everything else (like favicon.ico) is cached for an hour. You may want to be
// more aggressive with this caching.
app.use(express.static("public", { maxAge: "1h" }));

app.use(morgan("tiny"));

app.all(
  "*",
  process.env.NODE_ENV === "development"
    ? (req, res, next) => {
        purgeRequireCache();

        return createRequestHandler({
          build: require(BUILD_DIR),
          mode: process.env.NODE_ENV,
        })(req, res, next);
      }
    : createRequestHandler({
        build: require(BUILD_DIR),
        mode: process.env.NODE_ENV,
      })
);
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
});

function purgeRequireCache() {
  // purge require cache on requests for "server side HMR" this won't let
  // you have in-memory objects between requests in development,
  // alternatively you can set up nodemon/pm2-dev to restart the server on
  // file changes, but then you'll have to reconnect to databases/etc on each
  // change. We prefer the DX of this, so we've included it for you by default
  for (const key in require.cache) {
    if (key.startsWith(BUILD_DIR)) {
      delete require.cache[key];
    }
  }
}
```

The core feature of this script is `createRequestHandler` provided by [@remix-run/express](https://github.com/remix-run/remix/tree/main/packages/remix-express), which actually delegates most of its work to [@remix-run/node](https://github.com/remix-run/remix/tree/main/packages/remix-node).

Perfect! **We can now use the [Lightship Node library](https://github.com/gajus/lightship) to bind the required probes to our Express server.** Lightship is agnostic and supports _any_ Node.js service, including [Express](https://expressjs.com/), which we’ll be using.

### Some env vars first

**In true [_12-factor_](https://12factor.net/) fashion, let’s [use environment variables](https://12factor.net/config) to bootstrap and drive our app.**

I’ll be using [dotenv](https://github.com/motdotla/dotenv).

#### Installing the library

`npm install -D dotenv`

#### Creating the env files

Create two empty files named .env and .env.sample — the former is already listed in .gitignore, but don’t add the latter.

Let’s provide values for a couple of env vars we’ll use. In both .env and .env.sample, write something like this:

```sh
K8S_SERVER_PORT=3000
K8S_PROBES_PORT=9000
```

#### Loading the env vars

In server.js, right after the `require`s, leverage dotenv to load the environment variables:

```js
const dotenv = require("dotenv");
```

### Adding the Kubernetes probes

<Slide severity="info" sx={{ mt: 2 }}>
  Lightship works by binding a [Fastify](https://www.fastify.io/) micro-server
  alongside your Express app. It’s super lightweight and convenient, but if
  you’d rather implement the logic directly within Express (using, say, [a
  pluggable router](https://expressjs.com/en/guide/routing.html#express-router))
  and cut the overhead, look at [Lightship’s
  `createLightship`](https://github.com/gajus/lightship/blob/main/src/factories/createLightship.ts)
  for inspiration.
  <br />
  Note that Lightship also depends on Sentry (see [issue
  #52](https://github.com/gajus/lightship/issues/52)).
</Slide>

#### Installing the library

`npm install lightship`

#### Registering the probes

Right after the Express app is created, we will register the Kubernetes probes using Lightship.

It’s a two steps process:

1. **creating a new `Lightship` object**
2. **calling `signalReady(){:.fn}`** on that object

<Slide severity="info">
  `createLightship` is an asynchronous function, yet CommonJS does not support
  top-level `await`. Therefore, make sure to wrap all of the Express-related
  code with an
  [IIFE](https://en.wikipedia.org/wiki/Immediately_invoked_function_expression),
  as shown below.
</Slide>

_I greyed existing code out to give you a hint on where to insert the new code:_

```js "const app = express()"#gray "function purgeRequireCache() {"#gray
// ...
const { createLightship } = require("lightship");

// ...

(async () => {
  const app = express();

  // k8s probes/monitoring
  const lightship = await createLightship({
    port: +process.env.K8S_PROBES_PORT,
  });

  // ...

  const port = process.env.K8S_SERVER_PORT || 3000;

  app.listen(port, () => {
    console.info(
      `Express server Listening on ports [HTTP :${port}] [K8S probes :${process.env.K8S_PROBES_PORT}]`
    );

    // Everything’s running fine, let’s change the server state to SERVER_IS_READY.
    lightship.signalReady();
  });
})();

function purgeRequireCache() {
  // ...
```

That’s it!

<Slide severity="info">
  You can have a look at [Lightship’s README for an alternative
  implementation](https://github.com/gajus/lightship#using-with-expressjs),
  using a top-level `await`.
</Slide>

There are two env vars:

- `K8S_PROBES_PORT` sets the port the Lightship micro-server will be running at & the Kubernetes diagnosis probes will connect to (defaults to :9000). Note that the env var string is cast to an integer using the [unary operator `+`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unary_plus), as Lightship expects a `Number`.
- `K8S_SERVER_PORT` is the Express app’s HTTP server port (Express defaults to :3000).

### Handling graceful shutdowns

**On top of providing Kubernetes diagnosis probes, Lightship has built-in support for termination signals ([SIGINT](<https://en.wikipedia.org/wiki/Signal_(IPC)#SIGINT>), [SIGTERM](<https://en.wikipedia.org/wiki/Signal_(IPC)#SIGTERM>), [SIGHUP](<https://en.wikipedia.org/wiki/Signal_(IPC)#SIGHUP>)) and will automatically (try to) perform a graceful shutdown** :sparkling_heart:

Before terminating the app’s process, though, there’s an opportunity to run arbitrary "shutdown handlers". Oddly enough, the README suggests calling `app.close()`, yet Lightship does in fact call it for us already:

```ts title="lightship/src/factories/createLightship.ts"
// ...

for (const shutdownHandler of shutdownHandlers) {
  try {
    await shutdownHandler();
  } catch (error) {
    log.error(
      {
        error: serializeError(error),
      },
      "shutdown handler produced an error"
    );
  }
}

if (shutdownHandlerTimeoutId) {
  clearTimeout(shutdownHandlerTimeoutId);
}

log.debug(
  "all shutdown handlers have run to completion; proceeding to terminate the Node.js process"
);

void app.close();

// ...
```

Besides listening to termination events, though, I like to react to any `"error"{:.string}` event Express may trigger:

```js
app.on("error", lightship.shutdown);
```

## Running the application locally

Choosing _Express Server_ as the deployment target not only generated server.js but also modified the way the `npm run dev` command operates. It now runs both a live backend component (`nodemon ./server.js`) and the traditional frontend development server (`remix watch`):

```json
"scripts": {
  // ...
  "dev": "run-p -l dev:*",
  "dev:node": "cross-env NODE_ENV=development nodemon ./server.js --watch ./server.js",
  "dev:remix": "remix watch",
  "start": "cross-env NODE_ENV=production node ./server.js"
  // ...
}
```

This way, `npm run dev` will start the Express+Lightship server(s) running on `K8S_SERVER_PORT` (:3000) and make the Node.js service Kubernetes-compliant :tada:

## Prod-testing the containerized application locally

One of the main benefits of running the Remix app within a container is achieving runtime consistency. For example, we could _locally_ build a Docker image containing Node.js and the app, while setting `NODE_ENV` to `production{:.string}`, so that we can test things out as if running live in production.

In package.json, add a `build:docker` script:

```json {4}
"scripts": {
  // ...
  "build": "remix build",
  "build:docker": ". ./.env && docker build ${NO_CACHE:+--no-cache} -t my-remix-app:${APP_VERSION:-latest} .",
  // ...
},
```

You can name the image anything you want. Here, I’m simply using `my-remix-app{:.string}`.

<Slide severity="info">
  - Sourcing the .env file makes the env vars available to the rest of the
  command. - There is support for disabling Docker’s layer cache while building,
  using `$NO_CACHE` (either set in .env, or from the command line itself).
</Slide>

Building requires a Dockerfile:

```docker
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
```

Notice `NODE_ENV` is set to `production`, and `K8S_SERVER_PORT` to `80` (`3000` or any other valid port would do, but I like the "production" vibe of `80` better). Those values will trump that of .env (for by default, dotenv does not override pre-existing env vars upon parsing the .env file).

It’s now only a matter of building the image and running a container from it.

Before that, make sure to add a version number as `APP_VERSION` in .env / .env.sample:

```sh
APP_VERSION=0.1.0
K8S_SERVER_PORT=3000
K8S_PROBES_PORT=9000
```

Then, build the Docker image:

```sh
npm run build:docker # builds my-remix-app:0.1.0
```

Finally, run a container:

```sh
docker run -it -p 3000:80 my-remix-app:0.1.0
```

You may now test the "production-iso" application at http://localhost:3000 :muscle:

## Deploying with Helm

**I like to call `npm run deploy` and be done with it. Let’s first review what this command does (spoiler: it delegates to [Helm](https://helm.sh/)), then set up the Helm Chart.**

<Slide severity="info">
  Actually, you don’t need Helm to deploy an app to Kubernetes: `kubectl` or
  even raw [HTTP calls](https://kubernetes.io/docs/reference/kubernetes-api/)
  would do. But using a so-called Kubernetes package manager is good practice.
</Slide>

Helm will merely push textual resources onto the cluster. The actual application will run into a container, derived from a Docker image — which has to be fetched somewhere, somehow. The right way to provide a Kubernetes cluster with Docker images is through a Docker registry.

A Docker registry stores images and makes them accessible from the Kubernetes cluster’s pods. Therefore, we first need to set up one such Docker registry, then locally build and push an image to it, and finally have Helm instruct the Kubernetes cluster to "deploy the app" by fetching the appropriate Docker image from the shared registry and attaching a new container in a suitable Pod.

### Setting up a Docker registry

Docker registries come in different shapes and flavors. Depending on whether your project is public or private, you’ll need support for public and/or private images (ie. authentication / authorization). You’ll also need to consider whether you want to go managed or on-premise.

There are numerous free or cheap managed offerings: [Docker Hub](https://hub.docker.com/) of course, [GitLab](https://www.gitlab.com/), [TreeScale](https://treescale.com/), [Canister](https://www.canister.io/), etc. I prefer to use an on-premise private registry hosted within the Kubernetes cluster I’m deploying to. You may use [Harbor](https://goharbor.io/), [Portus](http://port.us.org/), [Trow](https://trow.io/), etc.

The exact procedure to set up the registry and log in to it (through `kubectl`, Helm and from within the Kubernetes cluster) may differ from one solution to the other. In my case, I’m using Trow as the Docker registry and [Traefik](https://traefik.io/traefik/) as the Edge Router:

<CodeTabs>
  <CodeTabs.Tab title="sh">

    ```sh
    helm repo add trow https://trow.io
    helm repo update
    helm install trow trow/trow -f trow-helm-config.yaml
    kubectl apply -f trow.yaml
    ```

  </CodeTabs.Tab>
  <CodeTabs.Tab title="trow-helm-config.yaml">

    ```yaml
    # https://github.com/ContainerSolutions/trow/blob/main/charts/trow/values.yaml

    trow:
      domain: registry.kaibun.net

    service:
      type: ClusterIP
    ````

  </CodeTabs.Tab>
  <CodeTabs.Tab title="trow.yaml">
    In this file, we’re describing Traefik’s CRD IngressRoute to allow external access to the deployed Trow registry. It works on the assumption that [TLS has been enabled](https://doc.traefik.io/traefik/https/acme/) within Traefik, under the `certResolver` name of `le` (for _Let’s Encrypt_).

    ```yaml
    apiVersion: traefik.containo.us/v1alpha1
    kind: IngressRoute
    metadata:
      name: trow-ingress
      namespace: default
    spec:
      entryPoints:
        - web
      routes:
        - match: Host(`registry.kaibun.net`)
          kind: Rule
          services:
            - name: trow
              port: 8000
          middlewares:
            - name: default-redirectscheme@kubernetescrd
              namespace: default

    ---
    apiVersion: traefik.containo.us/v1alpha1
    kind: IngressRoute
    metadata:
      name: trow-ingress-tls
      namespace: default
    spec:
      entryPoints:
        - websecure
      routes:
        - match: Host(`registry.kaibun.net`)
          kind: Rule
          services:
            - name: trow
              port: 8000
          middlewares:
            # @see https://doc.traefik.io/traefik/middlewares/http/basicauth/
            - name: default-dashboard-basic-auth@kubernetescrd
      tls:
        certResolver: le
    ```

  </CodeTabs.Tab>
</CodeTabs>

<Slide severity="info">
  Using a third-party edge router such as Traefik is not required. Instead, you
  may leverage Kubernetes’ built-in
  [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
  resources to allow external access to the registry. What matters is for the
  registry to get a public-facing URL eventually, so that Docker images can be
  pushed to and fetched from it.
</Slide>

### Building an image locally

In package.json, `build:docker` actually reads like that:

```json {4}
"scripts": {
  // ...
  "build": "run-p build:docker build:remix",
  "build:docker": ". ./.env && docker build ${NO_CACHE:+--no-cache} -t registry.kaibun.net/my-remix-app:${APP_VERSION:-latest} .",
  "build:remix": "remix build",
  // ...
},
```

Here, the image’s name is `registry.kaibun.net/my-remix-app{:.string}`, which is composed of two parts:

- the expected "dumb" name: `my-remix-app{:.string}`
- a prefix that’s the name (URL, really!) of a private [Docker registry](https://docs.docker.com/registry/): `registry.kaibun.net{:.string}`

In that example, the registry is made available at https://registry.kaibun.net thanks to the edge router.

<Slide severity="info">
  Naming Docker images along a registry’s public-facing URL has the nice
  [side-effect of
  _automating_](https://docs.docker.com/engine/reference/commandline/tag/) the
  push & pull operations with the registry (no need to [tag the
  image](https://docs.docker.com/engine/reference/commandline/push/#push-a-new-image-to-a-registry),
  as tools such as `kubectl` and `helm` will derive the registry’s URL from the
  very image’s name).
</Slide>

### Pushing the local image to the registry

Once an image is built locally with `npm run build:docker`, it can be pushed to the registry:

```json {6}
"scripts": {
  // ...
  "build": "run-p build:docker build:remix",
  "build:docker": ". ./.env && docker build ${NO_CACHE:+--no-cache} -t registry.kaibun.net/my-remix-app:${APP_VERSION:-latest} .",
  "build:remix": "remix build",
  "push": ". ./.env && docker push registry.kaibun.net/my-remix-app:${APP_VERSION:-latest}",
  // ...
},
```

Running `npm run push` after building an image will push that image to the registry.

#### Storing the registry’s authentication credentials in a Secret

**If you wish to use a private Docker registry, authentication is required.**

Let’s authenticate once with the explicit credentials to obtain an auth key that Docker will save in its config and that we’ll push into a Kubernetes Secret in the cluster to ease fetching from and pushing to the registry.

Once a user’s credentials are set up with the registry (the exact procedure will depend on the registry solution you chose), you may `docker login` with the credentials to obtain an auth key. In my example, the registry is available at https://registry.kaibun.net/ and protected with Basic Auth; therefore, I can log in by running:

```sh
docker login registry.kaibun.net
```

Upon successful authentication, it will populate ~/.docker/config.json with an auth key:

```json
{
  "auths": {
    "https://index.docker.io/v1/": {},
    "registry.kaibun.net": {
      "auth": "[PRIVATE_KEY]"
    }
  }
}
```

That private auth key must be pushed to the Kubernetes cluster for the cluster to be able to pull Docker images and deploy the app automatically:

```sh
kubectl -n somenamespace create secret generic registry-kaibun \
  --from-file=.dockerconfigjson=/home/[USER]/.docker/config.json --type=kubernetes.io/dockerconfigjson
```

### Creating a Helm Chart to automate deployments

From the moment the image is available in the registry, the application may be deployed in production, with helm:

```json {7,8}
"scripts": {
  // ...
  "build": "run-p build:docker build:remix",
  "build:docker": ". ./.env && docker build ${NO_CACHE:+--no-cache} -t registry.kaibun.net/my-remix-app:${APP_VERSION:-latest} .",
  "build:remix": "remix build",
  "push": ". ./.env && docker push registry.kaibun.net/my-remix-app:${APP_VERSION:-latest}",
  "deploy": "cd helm-chart && helm upgrade --install -n somenamespace --create-namespace my-remix-app .",
  "undeploy": "helm uninstall -n somenamespace my-remix-app",
  // ...
},
```

To execute `npm run deploy`, we must first create a new Helm Chart for the project:

```sh
# Let’s create ./helm-chart with everything Helm-related.
helm create helm-chart
```

Here are the important files and settings required for deploying the app:

<CodeTabs>
  <CodeTabs.Tab title="Chart.yaml">
    In this file, make sure to name the Chart something reasonable (I like using the same name as the Docker image’s). Ensure `appVersion` matches `APP_VERSION` (it can be [automated by reading from .env](https://stackoverflow.com/a/66262483/836757)).

    ```yaml {2,24}
    apiVersion: v2
    name: my-remix-app
    description: A Remix app deployed on Kubernetes

    # A chart can be either an 'application' or a 'library' chart.
    #
    # Application charts are a collection of templates that can be packaged into versioned archives
    # to be deployed.
    #
    # Library charts provide useful utilities or functions for the chart developer. They're included as
    # a dependency of application charts to inject those utilities and functions into the rendering
    # pipeline. Library charts do not define any templates and therefore cannot be deployed.
    type: application

    # This is the chart version. This version number should be incremented each time you make changes
    # to the chart and its templates, including the app version.
    # Versions are expected to follow Semantic Versioning (https://semver.org/)
    version: 0.1.0

    # This is the version number of the application being deployed. This version number should be
    # incremented each time you make changes to the application. Versions are not expected to
    # follow Semantic Versioning. They should reflect the version the application is using.
    # It is recommended to use it with quotes.
    appVersion: "0.1.0"
    ```

  </CodeTabs.Tab>
  <CodeTabs.Tab title="values.yaml">
    In this file, we’re describing where and how to fetch the Docker image required to deploy the app. The image is available in a registry (ie. `repository`). For it is private, an access key has been registered and stored inside a Kubernetes [Secret](https://kubernetes.io/docs/concepts/configuration/secret/) named `registry-kaibun` (see previous step).

    ```yaml {7-11,13-14}
    # Default values for helm-chart.
    # This is a YAML-formatted file.
    # Declare variables to be passed into your templates.

    replicaCount: 1

    image:
      repository: registry.kaibun.net/my-remix-app
      pullPolicy: Always
      # Overrides the image tag whose default is the chart appVersion.
      tag: ""

    imagePullSecrets:
      - name: registry-kaibun

    nameOverride: ""
    fullnameOverride: ""

    # ...
    ```

  </CodeTabs.Tab>
  <CodeTabs.Tab title="templates/deployment.yaml">
    In this file, we make sure to abide by the ports number we used in .env (`K8S_SERVER_PORT` and `K8S_PROBES_PORT`). We instruct Kubernetes about which HTTP endpoints to consume for its diagnosis probes, following along [Lightship’s official documentation](https://kubernetes.io/docs/concepts/configuration/secret/).

    ```yaml {15-19,24-50}
    apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: {{ include "helm-chart.fullname" . }}
      labels:
        {{- include "helm-chart.labels" . | nindent 4 }}
    spec:
      # ...
          containers:
            - name: {{ .Chart.Name }}
              securityContext:
                {{- toYaml .Values.securityContext | nindent 12 }}
              image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
              imagePullPolicy: {{ .Values.image.pullPolicy }}
              ports:
                - name: http
                  containerPort: 80
                  protocol: TCP
                - name: probes
                  containerPort: 9000
                  protocol: TCP
              resources:
                {{- toYaml .Values.resources | nindent 12 }}
              livenessProbe:
                httpGet:
                  path: /live
                  port: probes
                failureThreshold: 3
                initialDelaySeconds: 10
                periodSeconds: 30
                successThreshold: 1
                timeoutSeconds: 5
              readinessProbe:
                httpGet:
                  path: /ready
                  port: probes
                failureThreshold: 1
                initialDelaySeconds: 5
                periodSeconds: 5
                successThreshold: 1
                timeoutSeconds: 5
              startupProbe:
                httpGet:
                  path: /live
                  port: probes
                failureThreshold: 3
                initialDelaySeconds: 10
                periodSeconds: 30
                successThreshold: 1
                timeoutSeconds: 5
          # ...
    ```

  </CodeTabs.Tab>
  <CodeTabs.Tab title="templates/ingressroute.yaml">
    We want our application to be available on the public internet, therefore we must set up some kind of [ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/). But instead of using Kubernetes’ built-in [Ingress resource](https://traefik.io/glossary/kubernetes-ingress-and-ingress-controller-101/), let’s leverage Traefik’s [IngressRoute](https://doc.traefik.io/traefik/routing/providers/kubernetes-crd/#kind-ingressroute) instead as it simplifies TLS (https://) management.

    In this file, we’re describing Traefik’s CRD IngressRoute to allow external access to the deployed app. It works on the assumption that [TLS has been enabled](https://doc.traefik.io/traefik/https/acme/) within Traefik, under the `certResolver` name of `le` (for _Let’s Encrypt_).

    ```yaml
    {{ if eq (len (lookup "traefik.containo.us/v1alpha1" "IngressRoute" .Release.Namespace "my-remix-app-ingress")) 0 }}
    apiVersion: traefik.containo.us/v1alpha1
    kind: IngressRoute
    metadata:
      name: my-remix-app-ingress
      namespace: somenamespace
    spec:
      entryPoints:
        - web
      routes:
        - match: Host(`my-remix-app.kaibun.net`)
          kind: Rule
          services:
            - name: my-remix-app
              port: {{ .Values.service.port }}
          middlewares:
            - name: default-redirectscheme@kubernetescrd
              namespace: default
    {{- end }}

    ---
    {{ if eq (len (lookup "traefik.containo.us/v1alpha1" "IngressRoute" .Release.Namespace "my-remix-app-ingress-tls")) 0 }}
    apiVersion: traefik.containo.us/v1alpha1
    kind: IngressRoute
    metadata:
      name: my-remix-app-ingress-tls
      namespace: somenamespace
    spec:
      entryPoints:
        - websecure
      routes:
        - match: Host(`my-remix-app.kaibun.net`)
          kind: Rule
          services:
            - name: my-remix-app
              port: {{ .Values.service.port }}
      tls:
        certResolver: le
    {{- end }}
    ```

  </CodeTabs.Tab>
</CodeTabs>

## Deploying the app

Now that everything’s set up, it’s time to deploy the app in production :tada:

Here’s the complete process:

```txt
npm run build:docker

> my-remix-app@0.1.0 build:docker
> . ./.env && docker build ${NO_CACHE:+--no-cache} -t registry.kaibun.net/my-remix-app:${APP_VERSION:-latest} .

[+] Building 234.6s (12/12) FINISHED
 => [internal] load build definition from Dockerfile                                     0.0s
 => => transferring dockerfile: 38B                                                      0.0s
 => [internal] load .dockerignore                                                        0.0s
 => => transferring context: 34B                                                         0.0s
 => [internal] load metadata for docker.io/library/node:18-alpine                        0.8s
 => [1/6] FROM docker.io/library/node:18-alpine@sha256:76e638eb0d73ac5f0b76d70df3ce1dda  0.0s
 => [internal] load build context                                                        0.1s
 => => transferring context: 1.10MB                                                      0.1s
 => CACHED [2/7] WORKDIR /usr/server/app                                                 0.0s
 => [3/6] COPY ./package.json ./                                                         0.0s
 => [4/6] RUN npm install                                                              216.0s
 => [5/6] COPY ./ .                                                                      0.3s
 => [6/6] RUN npm run build                                                             10.1s
 => exporting to image                                                                   7.3s
 => => exporting layers                                                                  7.3s
 => => writing image sha256:be23f4351b87550b8ee1889ee785b6f0379c767a6cd5894382112efe3a4  0.0s
 => => naming to registry.kaibun.net/my-remix-app:0.1.0                                    0.0s

```

```txt
npm run push

> my-remix-appg@0.1.0 push
> . ./.env && docker push registry.kaibun.net/my-remix-app:${APP_VERSION:-latest}

The push refers to repository [registry.kaibun.net/my-remix-app]
ead07a462750: Pushed
33c5191ab632: Pushed
e8c649d536ca: Pushed
611d381ee987: Pushed
8b4a7e9aedfc: Pushed
71e6e957dca1: Layer already exists
e6a74996eabe: Layer already exists
db2e1fd51a80: Layer already exists
19ebba8d6369: Layer already exists
4fc242d58285: Layer already exists
0.1.0: digest: sha256:04cc4a0ce9c55b1f4a0dae56f5cd20b97e834ff2b556bf15a4131090d6c139a1 size: 2416
```

```txt
npm run deploy

> my-remix-app@0.1.0 deploy
> cd helm-chart && helm upgrade --install -n somenamespace --create-namespace my-remix-app .

Release "my-remix-app" does not exist. Installing it now.
NAME: my-remix-app
LAST DEPLOYED: Mon Feb 27 04:40:55 2023
NAMESPACE: somenamespace
STATUS: deployed
REVISION: 1
NOTES:
1. Get the application URL by running these commands:
  export POD_NAME=$(kubectl get pods --namespace somenamespace -l "app.kubernetes.io/name=my-remix-app,app.kubernetes.io/instance=my-remix-app" -o jsonpath="{.items[0].metadata.name}")
  export CONTAINER_PORT=$(kubectl get pod --namespace somenamespace $POD_NAME -o jsonpath="{.spec.containers[0].ports[0].containerPort}")
  echo "Visit http://127.0.0.1:8080 to use your application"
  kubectl --namespace somenamespace port-forward $POD_NAME 8080:$CONTAINER_PORT
```

**And just like that, our Remix app is running live on Kubernetes at https://my-remix-app.kaibun.net!**

Future deployments will be the same:

```sh
npm run build:docker
npm run push
npm run deploy
```

All things considered, that’s quite the amount of boilerplate, but it could be easily transformed into a [Remix stack](https://remix.directory/), improving the DX dramatically. _Happy Remixing!_
