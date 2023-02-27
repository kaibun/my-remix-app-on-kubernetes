const path = require("path");
const express = require("express");
const compression = require("compression");
const morgan = require("morgan");
const { createRequestHandler } = require("@remix-run/express");
const { createLightship } = require("lightship");

const dotenv = require("dotenv");

const BUILD_DIR = path.join(process.cwd(), "build");

(async () => {
  const app = express();

  // k8s probes/monitoring
  const lightship = await createLightship({
    port: +process.env.K8S_PROBES_PORT,
  });

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
