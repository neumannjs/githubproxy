var jwt = require("jsonwebtoken");

function validateAccessToken(req, context) {
  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  };
  let token;
  context.log(typeof req.headers.authorization);
  if (typeof req.headers.authorization !== "undefined") {
    token = req.headers.authorization.replace("Bearer ", "");
  } else {
    context.res = {
      status: 401,
      body: "Token not found",
    };
    context.done();
  }

  let decoded;

  try {
    // The access token provided by Github does not have a expiration date,
    // although Github does revoke the token automatically in certain
    // situations. (see:
    // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
    // In any case it does not make sense to implement the refreshing of the
    // access token, although the indieauth spec does support it. (see:
    // https://indieauth.spec.indieweb.org/#refresh-tokens)

    decoded = jwt.verify(token, config.clientSecret, {
      ignoreExpiration: true,
    });
  } catch (err) {
    context.log("Decrypting jwt failed");
    context.res = {
      status: 401,
      body: "Decrypting jwt failed",
    };
    context.done();
  }

  return decoded;
}

module.exports = validateAccessToken;
