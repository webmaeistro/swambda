"use strict";

const SwaggerParser = require("swagger-parser");
const Router = require("swagger-router").Router;
const utils = require("./utils");

module.exports.load = (callingPath, path) => {
  return new Promise((resolve, reject) => {
    if(global.router) {
      resolve(global.router);
      return;
    }
    let spec;
    if(typeof file === "object") {
      path = undefined;
      spec = file;
    }
    SwaggerParser.validate(path, spec)
      .then(api => {
        let moduleName = callingPath.substring(callingPath.indexOf("/.netlify/functions/"))
          .substring("/.netlify/functions/".length).split("/")[0];

        if(callingPath.startsWith("/" + moduleName)) {
          api.basePath = "/" + moduleName + "/.netlify/functions/" + moduleName;
        }
        else {
          api.basePath = "/.netlify/functions/" + moduleName;
        }

        let r = new SwaggerRouter();
        r.spec = api;
        const router = new Router();
        router.setTree(router.specToTree(r.spec));
        r.router = router;

        global.router = r;
        resolve(r);
      });
  });
}

const SwaggerRouter = module.exports.SwaggerRouter = class SwaggerRouter {
  constructor() {}
}

SwaggerRouter.prototype.process = function (event) {
  return new Promise((resolve, reject) => {
    const path = event.path.substring(this.spec.basePath.length);
    const httpMethod = event.httpMethod.toLowerCase();

    if(httpMethod === "options") {
      respondWith(resolve, 200, "");
      return;
    }

    if(!path) {
      respondWith(resolve, 404, {
        statusCode: 404,
        body: {
          code: 404,
          message: "invalid path"
        }});
        return;
    }
    if(path === "/swagger.json") {
      respondWith(resolve, 200, this.spec);
      return;
    }
    const route = this.router.lookup(path);
    const operation = route.value[httpMethod];
    if(!route) {
      respondWith(resolve, 404, {
        statusCode: 404,
        body: {
          code: 404,
          message: "path " + path + " not found"
        }});
        return;
    }

    const params = {};
    const args = {};
    const controller = operation["x-swagger-router-controller"];
    const operationId = operation.operationId;
    (operation.parameters || [])
      .map((param) => {
        if(param.in === "path") {
          const value = extractValue(param, route.params);
          if(typeof value !== "undefined") {
            args[param.name] = value;
          }
        }
        if(param.in === "body") {
          const value = parseBody(event.headers, event.body);
          if(typeof value !== "undefined") {
            args[param.name] = value;
          }
        }
        if(param.in === "query") {
          const value = extractValue(param, event.queryStringParameters);
          if(typeof value !== "undefined") {
            args[param.name] = value;
          }
        }
        if(param.in === "header") {
          const value = extractValue(param, event.headers);
          if(typeof value !== "undefined") {
            args[param.name] = value;
          }
        }
        params[param.name] = param;
    });

    const str = Object.keys(args).map(arg => {
      return arg + ": " + args[arg];
    });
    let cls;
    try {
      const classname = "" + controller;
      cls = require(`../../controllers/${controller}`);
    }
    catch(e) {
      respondWith(resolve, 400, {
        code: 400,
        message: "class " + controller + " not found"
      });
      return;
    }
    if(!cls || typeof cls[operationId] !== "function") {
      respondWith(resolve, 404, {
        code: 404,
        message: "operation not found"
      });
      return;
    }
    cls[operationId](args)
      .then(response => {
        resolve(response);
      })
      .catch(err => {
        respondWith(resolve, 500, {
          statusCode: 500,
          body: {
            code: 500,
            message: "bad operation"
          }});
      });
  })
}

module.exports.prettyPrint = (error, value) => {
  console.log(JSON.stringify(value, null, 2));
}

const parseBody = (headers, body) => {
  if(typeof body === "undefined") {
    return;
  }
  if(headers && headers["content-type"]) {
    try {
      return JSON.parse(body);
    }
    catch(e) {
      return body;
    }
  }
}

const extractValue = (param, source) => {
  const value = source[param.name];
  if(!value) {
    return;
  }
  switch(param.type) {
    case "integer":
      const result = parseInt(value);
      return isNaN(result) ? undefined : result;
    case "boolean":
      return value === "true";
    default:
      return value;
  }
}
