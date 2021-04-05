const request = require("request");

module.exports = function (context, req) {
  context.log("Proxy Github authorization redirect request " + req.method);

  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  };

  if (req.query.state && req.method === "GET") {
    let redirectUrl =
      "https://github.com/login/oauth/authorize" +
      "?client_id=" +
      encodeURI(config.clientId) +
      "&redirect_uri=" +
      encodeURI(config.redirectUri) +
      "&state=" +
      encodeURI(req.query.redirect_uri + "|" + req.query.state);
    redirectUrl = addOptionalArgument(
      redirectUrl,
      "protocol",
      req.query.protocol
    );
    redirectUrl = addOptionalArgument(
      redirectUrl,
      "response_type",
      req.query.response_type
    );
    redirectUrl = addOptionalArgument(redirectUrl, "scope", req.query.scope);
    https: context.res = {
      status: 302,
      headers: {
        location: redirectUrl,
      },
      body: null,
    };
    context.done();
  } else if (req.method === "POST") {
    context.log("RECEIVED POST!");
    const headers = context.req.headers;
    const body = JSON.parse(
      '{"' +
        decodeURI(context.req.body)
          .replace(/"/g, '\\"')
          .replace(/&/g, '","')
          .replace(/=/g, '":"') +
        '"}'
    );
    const url = "https://github.com/login/oauth/access_token";
    const options = {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code: body.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }),
    };

    // Request to GitHub with the given code
    request(url, options, function (err, response) {
      if (err) {
        context.done({ status: 500, error: err });
        return;
      }

      const responseBody = JSON.parse(response.body);

      const AuthorizedOptions = {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/vnd.github.mercy-preview+json", // custom media type to get topics in repository results
          "User-Agent": headers["user-agent"],
          Authorization: "token " + responseBody.access_token,
        },
      };

      request(
        "https://api.github.com/user",
        AuthorizedOptions,
        function (userInfoErr, userInfoResponse) {
          if (userInfoErr) {
            context.log(userInfoErr);
            context.done({ status: 500, error: userInfoErr });
            return;
          }

          const userObject = JSON.parse(userInfoResponse.body);
          const response = { me: userObject.blog };
          context.res = {
            status: 200,
            body: JSON.stringify(response),
            headers: { "Content-Type": "application/json" },
          };
          context.done();
        }
      );
    });
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
