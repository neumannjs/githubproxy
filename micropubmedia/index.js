const multipart = require("parse-multipart");
const { Octokit } = require("@octokit/core");

const validateAccessToken = require("../shared-code/validate-access-token");

module.exports = async function (context, req) {
  context.log("Proxy Github micropub media " + req.method);

  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  };

  const repo = context.bindingData.repo;
  const user = context.bindingData.user;

  if (req.method === "POST") {
    let decoded = validateAccessToken(req, context);

    const bodyBuffer = Buffer.from(req.body);
    try {
      const octokit = new Octokit({
        auth: decoded.access_token,
      });

      const boundary = multipart.getBoundary(req.headers["content-type"]);
      const parts = multipart.Parse(bodyBuffer, boundary);
      const ts = Date.now();
      const date_time = new Date(ts);
      const filename = `stream/${date_time.getFullYear()}/${
        date_time.getMonth() + 1
      }/${date_time.getDate()}/${parts[0].filename}`;

      // File contents
      let fileContents = parts[0].data;
      const compare = Buffer.from("\r\n");
      if (fileContents.compare(compare, 0, 2, 0, 2) === 0) {
        // If the buffer starts with CR LF, then remove those first two bytes. See: https://github.com/aaronpk/Quill/issues/141
        fileContents = fileContents.subarray(2);
      }

      // Check if file exists:

      let fileObject = {
        owner: user,
        repo: repo,
        content: fileContents.toString("base64"),
        path: filename,
        encoding: "base64",
        message: "micropubmedia image upload",
        branch: "master",
      };

      try {
        // TODO: This breaks down with files over 1MB. See: https://github.com/hub4j/github-api/issues/878
        const file = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          {
            owner: user,
            repo: repo,
            path: filename,
            ref: "master",
          }
        );
        fileObject.sha = file.data.sha;
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }

      const uploadFile = await octokit.request(
        "PUT /repos/{owner}/{repo}/contents/{path}",
        fileObject
      );

      context.log(uploadFile);

      context.res = {
        headers: {
          location: decoded.me + filename,
        },
        status: 201,
      };
      context.done();
    } catch (err) {
      context.res = {
        status: 400,
        body: String(err),
      };
      context.done();
    }
  }
};
