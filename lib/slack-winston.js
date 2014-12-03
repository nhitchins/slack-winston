'use strict';

var util = require('util')
, winston = require('winston')
, request = require('request')
, Stream = require('stream').Stream
, _ = require('lodash')

//
// ### function Slack (options)
// #### @options {Object} Options for this instance.
// Constructor function for the Slack transport object responsible
// for persisting log messages and metadata to a terminal or TTY.
//
var Slack = exports.Slack = function (options) {
  winston.Transport.call(this, options)
  this.name = 'Slack'
  this.options = options || {}
  if (!options.webhookUrl) throw new Error('Must have a webhook Url set.')
}

util.inherits(Slack, winston.Transport)

//
// Expose the name of this Transport on the prototype
//
Slack.prototype.name = 'Slack'

//
// ### function _request (options, callback)
// #### @callback {function} Continuation to respond to when complete.
// Make a request to a winstond server or any http server which can
// handle json-rpc.
//
Slack.prototype._request = function (options, callback) {
  options = options || {}

  options.method = 'POST';
  options.params.meta = Object.keys(options.params.meta).length ? JSON.stringify(options.params.meta, null, 2) : ''

  // construct message body
  var body = {
    text: this.options.message ? _.template(this.options.message, options.params, {interpolate: /\{\{(.*?)\}\}/g}) : options.params.message + (options.params.meta ? '\n\n' + options.params.meta : '')
  }

  if (this.options.channel !== undefined) { body.channel = this.options.channel; }
  if (this.options.username !== undefined) { 
    if (this.options.username === "LEVEL") {
      body.username = this.options.username;
    }
    else {
      body.username = options.level; 
    }
  }

  if (this.options.icon_emoji !== undefined) { body.icon_emoji = this.options.icon_emoji; }
  if (this.options.icon_url !== undefined) { body.icon_url = this.options.icon_url; }
  if (this.options.attachments !== undefined) { body.attachments = this.options.attachments; }
  if (this.options.unfurl_links !== undefined) { body.unfurl_links = this.options.unfurl_links; }

  options.body = JSON.stringify(body);
  options.json = true;
  options.url = this.options.webhookUrl;

  return request(options, callback);
}

//
// ### function log (level, msg, [meta], callback)
// #### @level {string} Level at which to log the message.
// #### @msg {string} Message to log
// #### @meta {Object} **Optional** Additional metadata to attach
// #### @callback {function} Continuation to respond to when complete.
// Core logging method exposed to Winston. Metadata is optional.
//
Slack.prototype.log = function (level, msg, meta, callback) {
  var self = this

  if (this.silent) return callback(null, true)

  if (typeof meta === 'function') {
    callback = meta
    meta = {}
  }

  var options = {
    method: 'collect'
  , params: {
      message: msg
    , meta: meta
    , level: level
    }
  }

  this._request(options, function (err, res) {

    if (res && res.statusCode !== 200) {
      err = new Error('winston: slack: HTTP Status Code: ' + res.statusCode)
    }

    if (err) return callback(err)

    // TODO: emit 'logged' correctly,
    // keep track of pending logs.
    self.emit('logged')

    if (callback) callback(null, true)
  })
}

//
// ### function query (options, callback)
// #### @options {Object} Loggly-like query options for this instance.
// #### @callback {function} Continuation to respond to when complete.
// Query the transport. Options object is optional.
//
Slack.prototype.query = function (options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }

  options = this.normalizeQuery(options)

  options = {
    method: 'query',
    params: options
  }

  this._request(options, function (err, res, body) {
    if (res && res.statusCode !== 200) {
      err = new Error('HTTP Status Code: ' + res.statusCode)
    }

    if (err) return callback(err)

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch (e) {
        return callback(e)
      }
    }

    callback(null, body)
  })
}

//
// ### function stream (options)
// #### @options {Object} Stream options for this instance.
// Returns a log stream for this transport. Options object is optional.
//
Slack.prototype.stream = function (options) {
  var stream = new Stream(),
      req,
      buff

  options = options || {}

  stream.destroy = function () {
    req.destroy()
  }

  options = {
    method: 'stream',
    params: options
  }

  if (options.params.path) {
    options.path = options.params.path
    delete options.params.path
  }

  if (options.params.auth) {
    options.auth = options.params.auth
    delete options.params.auth
  }

  req = this._request(options)
  buff = ''

  req.on('data', function (data) {

    data = (buff + data).split(/\n+/)
    var l = data.length - 1
    var i = 0

    for (; i < l; i++) {
      try {
        stream.emit('log', JSON.parse(data[i]))
      } catch (e) {
        stream.emit('error', e)
      }
    }

    buff = data[l]
  })

  req.on('error', function (err) {
    stream.emit('error', err)
  })

  return stream
}
