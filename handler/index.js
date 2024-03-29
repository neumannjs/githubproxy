// TODO: Replace request module, because it is deprecated https://github.com/request/request/issues/3142
const request = require("request");
require("dotenv").config();

const config = {
  clientId: process.env.CLIENTID,
  clientSecret: process.env.CLIENTSECRET,
  redirectUri: process.env.REDIRECT_URI,
  allowedOrigins: [],
};

const handler = function (context) {
  config.allowedOrigins = [];
  // For development we allow localhost as an allowedOrigin. *BUT* if you want
  // to test the create repo functionality for new users, you should comment
  // this out. The flow for a new users starts when he request an admin for a
  // site that is *not* in his allowedOrigins.
  // if (process.env.NODE_ENV === "development") {
  //   config.allowedOrigins.push("http://localhost:5500");
  //   config.allowedOrigins.push("http://localhost:3000");
  // }
  context.log("Proxy Accescode request");
  // Retrieve the request, more details about the event variable later
  const headers = context.req.headers;
  const body = JSON.parse(
    '{"' +
      decodeURI(context.req.body)
        .replace(/"/g, '\\"')
        .replace(/&/g, '","')
        .replace(/=/g, '":"') +
      '"}'
  );
  const origin = headers.origin || headers.Origin;

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
        context.log(userObject);
        const username = userObject.login;
        const allowedOrigins = config.allowedOrigins;
        const userGithubDomain = username + ".github.io";

        // for now we only allow people to edit their *own* repositories
        // TODO: (Optional) Allow access to other repositories as well
        allowedOrigins.push("https://" + userGithubDomain);

        request(
          "https://api.github.com/user/orgs",
          AuthorizedOptions,
          function (userOrgsInfoErr, userOrgsInfoResponse) {
            if (userOrgsInfoErr) {
              context.log(userOrgsInfoErr);
              context.done({ status: 500, error: userOrgsInfoErr });
              return;
            }
            const userOrgsObject = JSON.parse(userOrgsInfoResponse.body);
            context.log(userOrgsObject);
            userOrgsObject.forEach((org) => {
              allowedOrigins.push("https://" + org.login + ".github.io");
            });

            let result = [];
            let personalGithubAvailable = false;
            // get the janos repos if there are any
            request(
              "https://api.github.com/user/repos",
              AuthorizedOptions,
              function (userReposErr, userInfoReposResponse) {
                if (userReposErr) {
                  context.done({ status: 500, error: userReposErr });
                  return;
                }

                const responseJson = JSON.parse(userInfoReposResponse.body);
                const janosRepos = responseJson.filter((repo) => {
                  return repo.topics && repo.topics.includes("janos");
                });

                //Add homepage property to allowedOrigins
                //This is used to allow for custom domains. If a custom domain is
                //configured this domain should be set as the homepage of the repo.
                janosRepos.forEach((repo) => {
                  allowedOrigins.push(repo.homepage);
                });
                // Check for malicious request
                if (!allowedOrigins.includes(origin)) {
                  personalGithubAvailable = !responseJson.some(
                    (repo) => repo.name === userGithubDomain
                  );

                  result = janosRepos.map((repo) => ({
                    name: repo.name,
                    url:
                      userGithubDomain === repo.name
                        ? "https://" + userGithubDomain + "/admin"
                        : "https://" +
                          userGithubDomain +
                          "/" +
                          repo.name +
                          "/admin",
                  }));

                  // If reponame is provided, and the user doesn't already have janos repos, create a new repo
                  if (
                    context.req.query.reponame &&
                    context.req.query.reponame.length > 0 &&
                    result.length === 0
                  ) {
                    const AuthorizedOptionsWithForm = AuthorizedOptions;
                    AuthorizedOptionsWithForm.form = JSON.stringify({
                      name: context.req.query.reponame,
                      include_all_branches: true,
                    });

                    AuthorizedOptions.headers.Accept =
                      "application/vnd.github.baptiste-preview+json";

                    request.post(
                      "https://api.github.com/repos/" +
                        process.env.TEMPLATE_REPO +
                        "/generate",
                      AuthorizedOptionsWithForm,
                      function (forkErr, forkResponse) {
                        if (forkErr) {
                          context.log(forkErr);
                          context.done({ status: 500, error: forkErr });
                          return;
                        }

                        if (forkResponse && forkResponse.statusCode === 201) {
                          // repo is created, now add topic (to be able to distinguish janos repo's later on)
                          // PUT /repos/:owner/:repo/topics
                          const AuthorizedOptionsWithBody = AuthorizedOptions;
                          AuthorizedOptionsWithBody.form =
                            '{"names": ["janos"]}';

                          AuthorizedOptionsWithBody.headers.Accept =
                            "application/vnd.github.mercy-preview+json";

                          context.log("Create topic");

                          request.put(
                            "https://api.github.com/repos/" +
                              username +
                              "/" +
                              context.req.query.reponame +
                              "/topics",
                            AuthorizedOptionsWithBody,
                            function (topicErr, topicResponse) {
                              if (topicErr) {
                                context.log("topic ERROR");
                                context.log(topicErr);
                                context.done({ status: 500, error: topicErr });
                                return;
                              }
                              context.log("topic response OK");
                              context.log(topicResponse.body);

                              const AuthorizedOptionsPages = AuthorizedOptions;
                              AuthorizedOptionsPages.form = JSON.stringify({
                                source: {
                                  branch: "master",
                                  path: "/docs",
                                },
                              });
                              AuthorizedOptionsPages.headers.Accept =
                                "application/vnd.github.switcheroo-preview+json";

                              context.log("Enable pages");

                              request.post(
                                "https://api.github.com/repos/" +
                                  username +
                                  "/" +
                                  context.req.query.reponame +
                                  "/pages",
                                AuthorizedOptionsPages,
                                function (pagesErr, pagesResponse) {
                                  if (pagesErr) {
                                    context.log("pages ERROR");
                                    context.log(pagesErr);
                                    context.done({
                                      status: 500,
                                      error: pagesErr,
                                    });
                                    return;
                                  }
                                  context.log("pages response OK");
                                  context.log(pagesResponse.statusCode);
                                  context.log(pagesResponse.body);

                                  // Sent back the an authentication error but with the newly created repository as info
                                  result = [
                                    {
                                      name: context.req.query.reponame,
                                      url:
                                        userGithubDomain ===
                                        context.req.query.reponame
                                          ? "https://" +
                                            userGithubDomain +
                                            "/admin"
                                          : "https://" +
                                            userGithubDomain +
                                            "/" +
                                            context.req.query.reponame +
                                            "/admin",
                                    },
                                  ];

                                  const error = `${origin} is not an allowed origin.`;
                                  context.res = {
                                    status: 401,
                                    body: {
                                      error: error,
                                      info: JSON.stringify(result),
                                    },
                                  };
                                  context.done();
                                }
                              );
                            }
                          );
                        } else {
                          context.res = {
                            status: 500,
                            body: {
                              error: JSON.parse(forkResponse.body),
                            },
                          };
                        }
                      }
                    );
                  } else {
                    if (result.length === 0 && personalGithubAvailable) {
                      result = [
                        {
                          create: userGithubDomain,
                        },
                      ];
                    }

                    const error = `${origin} is not an allowed origin.`;
                    context.res = {
                      status: 401,
                      body: {
                        error: error,
                        info: JSON.stringify(result),
                      },
                    };
                    context.done();
                  }
                } else {
                  context.res = {
                    status: 200,
                    body: JSON.parse(response.body),
                    headers: { "Content-Type": "application/xml" },
                    isRaw: true,
                  };

                  context.done();
                }
              }
            );
          }
        );
      }
    );
  });
};

module.exports = handler;
