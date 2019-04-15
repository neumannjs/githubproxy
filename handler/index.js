const request = require('request')
require('dotenv').config()

const config = {
    clientId: '93af288610e66a7a64a9',
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: 'http://localhost:7071/api/callback',
    allowedOrigins: [],
};

// if (process.env.NODE_ENV === 'development') {
//     config.allowedOrigins.push('http://localhost:3000')
// }

const handler = function (context) {
    context.log('Proxy Accescode request')
    // Retrieve the request, more details about the event variable later
    const headers = context.req.headers;
    const body = JSON.parse('{"' + decodeURI(context.req.body).replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g,'":"') + '"}');
    const origin = headers.origin || headers.Origin;

    const url = 'https://github.com/login/oauth/access_token';
    const options = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            code: body.code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
        }),
    };

    // Request to GitHub with the given code
    request(url, options, function(err, response) {
        if (err) {
            context.done({ status: 500, error: err });
            return;
        }

        const responseBody = JSON.parse(response.body)

        let AuthorizedOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': headers['user-agent'],
                'Authorization': 'token ' + responseBody.access_token
            }
        }
        
        request('https://api.github.com/user', AuthorizedOptions, function(userInfoErr, userInfoResponse) {
            if (userInfoErr) {
                context.done({ status: 500, error: userInfoErr });
                return;
            }

            let userObject  = JSON.parse(userInfoResponse.body)
            let username = userObject.login
            let allowedOrigins = config.allowedOrigins

            allowedOrigins.push('https://' + username + '.github.io')
            
            // Check for malicious request
            if (!allowedOrigins.includes(origin)) {
                let error = `${origin} is not an allowed origin.`
                context.res = {
                    status: 401,
                    body: error
                }
            } else {
                context.res = {
                    status: 200,
                        body: JSON.parse(response.body),
                        headers: { 'Content-Type': 'application/xml' },
                        isRaw: true
                    }
            }
                
            context.done();
           
        })
    });
};

module.exports = handler