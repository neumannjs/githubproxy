const createHandler = require('azure-aws-serverless-express')
const express = require('express')
const micropub = require('micropub-express')
const MicropubFormatter = require('format-microformat')
const GitHubPublisher = require('github-publish')
const { Octokit } = require('@octokit/core')
const getType = require('post-type-discovery')
const matter = require('gray-matter')
const nunjucks = require('nunjucks')
const nunjucksDateFilter = require('nunjucks-date-filter')
const marked = require('marked')
const webmention = require('send-webmention')
const axios = require('axios')
const validateAccessToken = require('../shared-code/validate-access-token')

module.exports = (context, req) => {
  const app = express()

  const config = {
    clientId: process.env.CLIENTID,
    clientSecret: process.env.CLIENTSECRET,
    redirectUri: process.env.REDIRECT_URI,
  }

  const repo = context.bindingData.repo
  const user = context.bindingData.user

  const syndicationTargets = [
    {
      uid: 'https://brid.gy/publish/twitter?bridgy_omit_link=true',
      name: 'twitter',
    },
    {
      uid: 'https://brid.gy/publish/mastodon?bridgy_omit_link=true',
      name: 'mastodon',
    },
    {
      uid: 'https://brid.gy/publish/github?bridgy_omit_link=true',
      name: 'github.com/gijswijs',
    },
    {
      uid: 'https://brid.gy/publish/meetup?bridgy_omit_link=true',
      name: 'meetup.com',
    },
  ]

  let decoded = validateAccessToken(req, context)

  //TODO: Use a proper environment variable for this. The replace is horrible. :`(
  const tokenReference = {
    me: decoded.me,
    endpoint: config.redirectUri.replace('callback', `token/${user}/${repo}`),
  }

  const publisher = new GitHubPublisher(decoded.access_token, user, repo)
  const octokit = new Octokit({
    auth: decoded.access_token,
  })

  const nunjucksLoader = nunjucks.Loader.extend({
    async: true,

    getSource: function (filename, callback) {
      publisher
        .retrieve('_layouts/' + filename)
        .then((file) => {
          callback(null, {
            src: file.content,
            path: filename,
          })
        })
        .catch((error) => {
          callback(error)
        })
    },
  })

  const nunjucksEnv = new nunjucks.Environment(new nunjucksLoader())
  nunjucksEnv.addFilter('date', nunjucksDateFilter)

  function renderAsync(name, context) {
    return new Promise((resolve, reject) => {
      nunjucksEnv.render(name, context, (err, html) => {
        if (err) {
          reject(err)
        }
        resolve(html)
      })
    })
  }

  function webmentionAsync(source, target) {
    return new Promise((resolve, reject) => {
      webmention(source, target, (err, obj) => {
        if (err) {
          reject(res)
        }

        if (obj.success) {
          let data = ''
          obj.res.on('end', function () {
            data = JSON.parse(data)
            resolve(data)
          })
          obj.res.on('data', function (chunk) {
            data += chunk
          })
        } else {
          reject(
            'Failure while reading response for webmention at target: ' + target
          )
        }
      })
    })
  }

  app.use(
    `/api/micropub/${user}/${repo}`,
    micropub({
      tokenReference,
      queryHandler: function (query, req) {
        let queryResponse = {}
        if (query === 'syndicate-to' || query === 'config') {
          queryResponse['syndicate-to'] = syndicationTargets
        }
        if (query === 'config') {
          queryResponse[
            'media-endpoint'
          ] = `https://janos-githubproxy.azurewebsites.net/api/micropubmedia/${user}/${repo}`
        }
        if (query === 'post-types' || query === 'config') {
          queryResponse['post-types'] = [
            {
              type: 'note',
              name: 'Note',
              properties: ['content', 'category', 'post-status', 'visibility'],
              'required-properties': ['content'],
            },
            {
              type: 'bookmark',
              name: 'Bookmark',
            },
            {
              type: 'rsvp',
              name: 'RSVP',
            },
            {
              type: 'photo',
              name: 'Photo',
            },
            {
              type: 'like',
              name: 'Like',
            },
            {
              type: 'listen',
              name: 'Listen',
            },
            {
              type: 'reply',
              name: 'Reply',
              properties: [
                'in-reply-to',
                'photo',
                'content',
                'category',
                'post-status',
                'visibility',
              ],
              'required-properties': ['in-reply-to', 'content'],
            },
            {
              type: 'repost',
              name: 'Repost',
              properties: [
                'repost-of',
                'photo',
                'content',
                'category',
                'post-status',
                'visibility',
              ],
              'required-properties': ['repost-of'],
            },
          ]
        }
        if (queryResponse !== {}) {
          return Promise.resolve().then(function () {
            return queryResponse
          })
        } else {
          return Promise.reject()
        }
      },
      handler: function (micropubDocument, req) {
        context.log(micropubDocument)
        // Post Type Discovery using 'The Algorithm'
        // Add it to the properties
        const postType = getType({
          items: [micropubDocument],
        })
        micropubDocument.properties.collection = postType

        // copy slug property from mp to properties (where the formatter expects
        // it)
        if (
          micropubDocument.properties.mp &&
          micropubDocument.properties.mp.slug &&
          micropubDocument.properties.mp.slug[0]
        ) {
          micropubDocument.properties.slug = micropubDocument.properties.mp.slug
        }
        // TODO: These properties should come out of metalsmith.json:
        // filenameStyle, filesStyle, permalinkStyle, layoutName
        const formatter = new MicropubFormatter({
          relativeTo: decoded.me,
          filenameStyle: `_src/stream/${postType}/:year/:month/:day-:slug`,
          filesStyle: 'stream/:year/:month/:day-:slug/:filesslug',
          permalinkStyle: `${postType}/:year/:month/:day-:slug`,
          layoutName: 'miksa/micropubpost.njk',
          deriveCategory: false,
        })

        return formatter.formatAll(micropubDocument).then(async (formatted) => {
          context.log('node-format-microformat returned:')
          context.log(formatted)
          // collection property is renamed by formatter to mf-collection (to
          // avoid possible collission with with pre-existing Jekyll properties)
          // but Metalsmith needs it as `collection`, so we need to rename it
          // back to the original. We also rename other properties that have
          // hyphens because hyphens don't play nice with nunjucks.
          let file = matter(formatted.content)
          file.data.collection = postType
          delete file.data['mf-collection']
          if (file.data['mf-location']) {
            file.data.location = file.data['mf-location']
            delete file.data['mf-location']
          }

          if (file.data['mf-like-of']) {
            file.data.likeof = file.data['mf-like-of']
            delete file.data['mf-like-of']
          }

          if (file.data['mf-repost-of']) {
            file.data.repostof = file.data['mf-repost-of']
            delete file.data['mf-repost-of']
          }

          if (file.data['mf-bookmark-of']) {
            file.data.bookmarkof = file.data['mf-bookmark-of']
            delete file.data['mf-bookmark-of']
          }

          if (file.data['mf-in-reply-to']) {
            file.data.inreplyto = file.data['mf-in-reply-to']
            delete file.data['mf-in-reply-to']
          }

          if (file.data['mf-photo']) {
            file.data.media = file.data['mf-photo']
            delete file.data['mf-photo']
          }

          // Sometime the syndication info is inside a mf field (which is against the spec)
          if (file.data['mf-mp-syndicate-to']) {
            file.data.syndicateTo = file.data['mf-mp-syndicate-to']
            delete file.data['mf-mp-syndicate-to']
          }

          // If the syndication info is inside the mp object, we should use that
          if (formatted.raw.mp && formatted.raw.mp['syndicate-to']) {
            file.data.syndicateTo = formatted.raw.mp['syndicate-to']
          }

          //metalsmith wants its tags comma-separated
          if (file.data.tags) {
            file.data.tags = file.data.tags.replace(/\s/g, ', ')
          }

          // Publish images/photos if there are any
          if (formatted.files) {
            const photos = formatted.files.map((file) => {
              const compare = Buffer.from('\r\n')
              let fileContents
              if (file.buffer.compare(compare, 0, 2, 0, 2) === 0) {
                // If the buffer starts with CR LF, then remove those first two bytes. See: https://github.com/aaronpk/Quill/issues/141
                fileContents = file.buffer.subarray(2)
              } else {
                fileContents = file.buffer
              }
              return octokit.request(
                'PUT /repos/{owner}/{repo}/contents/{path}',
                {
                  owner: user,
                  repo: repo,
                  path: file.filename,
                  message: 'micropub image for a ' + postType,
                  content: fileContents.toString('base64'),
                }
              )
            })
            await Promise.all(photos)
          }

          // create a simple html file using the javascript object based on the
          // formatted markdown file content this file is then used for syndication to other platforms
          // this file can also be used for sending webmentions to other webmention endpoints, if this is in reply to something.
          // After this a markdown file will be published as well, that will result in a nicely styled html file after a Metalsmith run.
          // TODO: Replace with values from metalsmith.json
          const renderedPage = await renderAsync(file.data.layout, {
            ...file.data,
            contents: marked(file.content),
            about_img: '/images/gijsvandam.jpg',
            author: 'Gijs van Dam',
            rootpath: '/',
            path: formatted.url.replace(decoded.me, ''),
          })

          const {
            data: {
              commit: { sha: latestSha },
            },
          } = await octokit.request(
            'PUT /repos/{owner}/{repo}/contents/{path}',
            {
              owner: user,
              repo: repo,
              path: formatted.url.replace(decoded.me, '') + '/index.html',
              message: 'micropub ' + postType,
              content: Buffer.from(renderedPage).toString('base64'),
            }
          )

          if (file.data.syndicateTo) {
            let status = ''
            while (status !== 'online' && status !== 'error') {
              await delay(5000)
              try {
                const response = await axios.get(formatted.url)
                status = 'online'
              } catch (error) {
                if (error.response.status !== 404) {
                  status = 'error'
                }
              }
            }

            const syndicate = file.data.syndicateTo.map(async (url) => {
              context.log('syndicate: ' + formatted.url + '/index.html')
              context.log('target: ' + url)
              const webmention = await webmentionAsync(
                formatted.url + '/index.html',
                url
              )
              return {
                destination: syndicationTargets.find(
                  (target) => target.uid === url
                ).name,
                url: webmention.url,
              }
            })
            await Promise.all(syndicate)
              .then((values) => {
                file.data.syndication = values
              })
              .catch((error) => {
                context.log('error from Bridgy')
                context.log(error.message)
              })
          }

          //metalsmith doesn't like quotes around dates, so we remove them
          formatted.content = file
            .stringify()
            .replace(/date\:\s\'(?<date>.*)\'/i, 'date: $<date>')

          // publish the markdown file, with the links to the syndicated content
          // On the next Metalsmith run this markdown file will be parsed and the resulting html file will replace the temporary one.
          return publisher
            .publish(formatted.filename, formatted.content)
            .then(function (result) {
              return Promise.resolve().then(function () {
                return { url: formatted.url }
              })
            })
        })
      },
    })
  )

  return createHandler(app)(context, req)
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms))
