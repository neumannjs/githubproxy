const { debug } = require("request");

module.exports = async function (context, req) {
  context.log("Proxy Github redirect");

  let state = decodeURI(req.query.state);
  // The state parameter contains the redirect uri combined with the
  // true state parameter. This is needed to be able to act as proxy without the
  // need of keeping state in this function
  const indexOfHttp = state.search(/https?:\/\//i);
  if (req.query.code && indexOfHttp > -1) {
    let redirectUrl = state.substring(indexOfHttp);
    // The true state parameter is separated from the redirect_uri with a |
    // character. We search for that character and then replace the values
    if (state.search(/\|/) > -1) {
      state = state.substring(state.search(/\|/) + 1);
      redirectUrl = redirectUrl.substring(0, redirectUrl.search(/\|/));
      context.log("state: " + state + "; redirectUrl: " + redirectUrl);
    }
    redirectUrl +=
      "?code=" +
      encodeURI(req.query.code) +
      "&state=" +
      encodeURI(state).replace(/%20/g, "%2B");
    context.res = {
      status: 302,
      headers: {
        location: redirectUrl,
      },
      body: null,
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
