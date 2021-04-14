const createHandler = require("azure-aws-serverless-express");
const express = require("express");
const micropub = require("micropub-express");
const jwt = require("jsonwebtoken");
const MicropubFormatter = require("format-microformat");
const GitHubPublisher = require("github-publish");
const { Octokit } = require("@octokit/core");
const getType = require("post-type-discovery");
const matter = require("gray-matter");
const nunjucks = require("nunjucks");
const nunjucksDateFilter = require("nunjucks-date-filter");
const marked = require("marked");
const webmention = require("send-webmention");

module.exports = (context, req) => {
  const app = express();

  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  };

  const repo = context.bindingData.repo;
  const user = context.bindingData.user;

  const token = req.headers.authorization.replace("Bearer ", "");
  let decoded;
  try {
    decoded = jwt.verify(token, config.clientSecret);
  } catch (err) {
    context.log("Decrypting jwt failed");
    context.done({ status: 500, error: "Decrypting jwt failed" });
    return;
  }

  //TODO: Use a proper environment variable for this. The replace is horrible. :`(
  const tokenReference = {
    me: decoded.me,
    endpoint: config.redirectUri.replace("callback", `token/${user}/${repo}`),
  };

  const publisher = new GitHubPublisher(decoded.access_token, user, repo);
  const octokit = new Octokit({
    auth: decoded.access_token,
  });

  const nunjucksLoader = nunjucks.Loader.extend({
    async: true,

    getSource: function (filename, callback) {
      publisher
        .retrieve("_layouts/" + filename)
        .then((file) => {
          callback(null, {
            src: file.content,
            path: filename,
          });
        })
        .catch((error) => {
          callback(error);
        });
    },
  });

  const nunjucksEnv = new nunjucks.Environment(new nunjucksLoader());
  nunjucksEnv.addFilter("date", nunjucksDateFilter);

  function renderAsync(name, context) {
    return new Promise((resolve, reject) => {
      nunjucksEnv.render(name, context, (err, html) => {
        if (err) {
          reject(err);
        }
        resolve(html);
      });
    });
  }

  function webmentionAsync(source, target) {
    return new Promise((resolve, reject) => {
      webmention(source, target, (err, obj) => {
        if (err) {
          reject(res);
        }

        if (obj.success) {
          let data = "";
          obj.res.on("end", function () {
            data = JSON.parse(data);
            resolve(data);
          });
          obj.res.on("data", function (chunk) {
            data += chunk;
          });
        } else {
          reject(
            "Failure while reading response for webmention at target: " + target
          );
        }
      });
    });
  }

  app.use(
    `/api/micropub/${user}/${repo}`,
    micropub({
      tokenReference,
      queryHandler: function (query, req) {
        if (query === "syndicate-to" || query === "config") {
          return Promise.resolve().then(function () {
            const syndicationResponse = {
              "syndicate-to": [
                {
                  uid: "https://brid.gy/publish/twitter",
                  name: "twitter.com/gijswijs",
                },
                {
                  uid: "https://brid.gy/publish/mastodon",
                  name: "bitcoinhackers.org/@gijswijs",
                },
              ],
            };
            return syndicationResponse;
          });
        }
      },
      handler: function (micropubDocument, req) {
        context.log(micropubDocument);
        // Post Type Discovery using 'The Algorithm'
        // Add it to the properties
        const postType = getType({
          items: [micropubDocument],
        });
        micropubDocument.properties.collection = postType;

        // copy slug property from mp to properties (where the formatter expects
        // it)
        if (
          micropubDocument.properties.mp &&
          micropubDocument.properties.mp.slug &&
          micropubDocument.properties.mp.slug[0]
        ) {
          micropubDocument.properties.slug =
            micropubDocument.properties.mp.slug;
        }
        // TODO: These properties should come out of metalsmith.json:
        // filenameStyle, filesStyle, permalinkStyle, layoutName
        const formatter = new MicropubFormatter({
          relativeTo: decoded.me,
          filenameStyle: `_src/stream/${postType}/:year/:month/:day-:slug`,
          filesStyle: "_src/stream/media/:year/:month/:day-:slug/:filesslug",
          permalinkStyle: `${postType}/:year/:month/:day-:slug`,
          layoutName: "miksa/micropubpost.njk",
          deriveCategory: false,
        });

        return formatter.formatAll(micropubDocument).then(async (formatted) => {
          context.log(formatted);
          // collection property is renamed by formatter to mf-collection (to
          // avoid possible collission with with pre-existing Jekyll properties)
          // but Metalsmith needs it as `collection`, so we need to rename it
          // back to the original. We also rename other properties that have
          // hyphens because hyphens don't play nice with nunjucks.
          let file = matter(formatted.content);
          file.data.collection = postType;
          delete file.data["mf-collection"];
          if (file.data["mf-location"]) {
            file.data.location = file.data["mf-location"];
            delete file.data["mf-location"];
          }

          if (file.data["mf-like-of"]) {
            file.data.likeof = file.data["mf-like-of"];
            delete file.data["mf-like-of"];
          }

          if (file.data["mf-repost-of"]) {
            file.data.repostof = file.data["mf-repost-of"];
            delete file.data["mf-repost-of"];
          }

          if (file.data["mf-bookmark-of"]) {
            file.data.bookmarkof = file.data["mf-bookmark-of"];
            delete file.data["mf-bookmark-of"];
          }

          if (file.data["mf-in-reply-to"]) {
            file.data.inreplyto = file.data["mf-in-reply-to"];
            delete file.data["mf-in-reply-to"];
          }

          // Put brid.gy syndication links in the content
          if (formatted.raw.mp && formatted.raw.mp["syndicate-to"]) {
            const syndicate = formatted.raw.mp["syndicate-to"].forEach(
              (url) => {
                file.content += "[](" + url + ")";
              }
            );
          }

          //metalsmith wants its tags comma-separated
          if (file.data.tags) {
            file.data.tags = file.data.tags.replace(/\s/g, ", ");
          }

          //create a simple html file using the javascript object based on the
          //formatted markdown file content
          // TODO: Replace with values from metalsmith.json
          const renderedPage = await renderAsync(file.data.layout, {
            ...file.data,
            contents: marked(file.content),
            about_img: "/images/gijsvandam.jpg",
            author: "Gijs van Dam",
            rootpath: "/",
            path: formatted.url.replace(decoded.me, ""),
          });

          const {
            data: {
              commit: { sha: latestSha },
            },
          } = await octokit.request(
            "PUT /repos/{owner}/{repo}/contents/{path}",
            {
              owner: user,
              repo: repo,
              path: formatted.url.replace(decoded.me, "") + "/index.html",
              message: "micropub " + postType,
              content: Buffer.from(renderedPage).toString("base64"),
            }
          );

          let latestCommit = "";
          let status = "";
          while (status !== "built" && latestCommit !== latestSha) {
            await delay(5000);
            const { data: returnData } = await octokit.request(
              "GET /repos/{owner}/{repo}/pages/builds/latest",
              {
                owner: user,
                repo: repo,
              }
            );
            status = returnData.status;
            latestCommit = returnData.commit;
          }

          // Wait for 10 seconds, just to be sure the file is online
          await delay(10000);

          if (formatted.raw.mp && formatted.raw.mp["syndicate-to"]) {
            const syndicate = formatted.raw.mp["syndicate-to"].map((url) => {
              return webmentionAsync(formatted.url + "/index.html", url);
            });
            file.data.syndication = (await Promise.all(syndicate)).map(
              (ret) => ret.url
            );
          }

          //metalsmith doesn't like quotes around dates, so we remove them
          formatted.content = file
            .stringify()
            .replace(/date\:\s\'(?<date>.*)\'/i, "date: $<date>");

          // publish the markdown file
          return publisher
            .publish(formatted.filename, formatted.content)
            .then(function (result) {
              return Promise.resolve().then(function () {
                return { url: formatted.url };
              });
            });
        });
      },
    })
  );

  return createHandler(app)(context, req);
};

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
