var jwt = require("jsonwebtoken");
const crypto = require("crypto");
var qs = require("qs");
const { Octokit } = require("@octokit/core");
const { createOAuthUserAuth } = require("@octokit/auth-oauth-user");

module.exports = async function (context, req) {
  context.log("Proxy Github token request " + req.method);

  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  };

  let body = {};
  if (context.req.body) {
    body = JSON.parse(
      '{"' +
        decodeURI(context.req.body)
          .replace(/"/g, '\\"')
          .replace(/&/g, '","')
          .replace(/=/g, '":"') +
        '"}'
    );
  }

  const headers = context.req.headers;
  const repo = context.bindingData.repo;
  const user = context.bindingData.user;

  if (req.method === "GET") {
    const token = headers.authorization.replace("Bearer ", "");

    let decoded;

    try {
      decoded = jwt.verify(token, config.clientSecret);
    } catch (err) {
      context.log("Decrypting jwt failed");
      context.done({ status: 500, error: "Decrypting jwt failed" });
      return;
    }

    let response = {
      me: decoded.me,
      scope: decoded.scope,
      client_id: decoded.client_id,
    };
    let contentTypeHeader = { "Content-Type": "application/json" };
    if (req.headers["content-type"] === "application/x-www-form-urlencoded") {
      response = qs.stringify(response);
      contentTypeHeader = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
    }
    context.res = {
      status: 200,
      body: response,
      headers: contentTypeHeader,
    };
    context.done();
  } else if (req.method === "POST") {
    const auth = createOAuthUserAuth({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: body.code,
    });

    const { token: access_token } = await auth();

    const octokit = new Octokit({
      auth: access_token,
    });

    const {
      data: { html_url },
    } = await octokit.request("GET /repos/{owner}/{repo}/pages", {
      owner: user,
      repo: repo,
    });

    if (!html_url) {
      context.done({ status: 500, error: repoObject });
      return;
    }
    const token = jwt.sign(
      {
        me: html_url,
        scope: "create update delete media read follow mute block channels",
        client_id: config.clientId,
        access_token: access_token,
        nonce: crypto.randomBytes(16).toString("base64"),
      },
      config.clientSecret,
      { expiresIn: "1h" }
    );

    let response = {
      access_token: token,
      me: html_url,
      scope: "create update delete media read follow mute block channels",
    };
    let contentTypeHeader = { "Content-Type": "application/json" };
    if (req.headers["content-type"] === "application/x-www-form-urlencoded") {
      response = qs.stringify(response);
      contentTypeHeader = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
    }
    context.res = {
      status: 200,
      body: response,
      headers: contentTypeHeader,
    };
    context.done();
  } else {
    context.res = {
      status: 500,
      body: "Incorrect request",
    };
    context.done();
  }
};

function addOptionalArgument(uri, key, value) {
  if (value) {
    uri = uri + "&" + key + "=" + encodeURI(value);
  }
  return uri;
}
