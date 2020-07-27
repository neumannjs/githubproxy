# Github Proxy

The Azure functions in this repository act as a proxy between the neumannssg spa and Github. It receives the client request and sends it to Github together with the secret code. It was this article that brought me on the path to this solution: <https://www.kmaschta.me/blog/2017/03/04/github-oauth-authentication-without-server/>
That articles secures everything by working with allowedOrigins, but the whole point of neumannssg is that everybody with a Github account can host their own site, using neumannssg. That's why this Github Proxy uses a dynamic approach to allowedOrigins:

The handler does a call to the Github API using the access token it just obtained to obtain the Github user name of the authorized user. With that username it adds [username] + '.github.io' to the allowedOrigins. If the user doesn't have access to the repository from which the request originated, it returns an error, with a list of links to neumannssg sites that could be found in the repositories of the authenticated user.

To run or test these Azure Functions locally, follow these steps:

1. Azure function tool requires a LTS supported version of Node. So make sure you run a supported version: <https://github.com/nodejs/Release#release-plan>
2. Install Azure function tool `npm install -g azure-functions-core-tools`
3. Install the Azure Functions extension for Visual Studio Code
4. Run vscode task runFunctionsHost
5. OR (for debugging) run Attach to JavaScript Functions
