"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse3(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse: parse3 };
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http = require("http");
    var net2 = require("net");
    var tls = require("tls");
    var { randomBytes, createHash: createHash3 } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL3 } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse: parse3 } = require_extension();
    var { toBuffer } = require_buffer_util();
    var closeTimeout = 30 * 1e3;
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL3) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL3(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL3(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash3("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse3(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net2.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net2.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      let chunk;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && (chunk = websocket._socket.read()) !== null) {
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open2() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open2() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse3(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse: parse3 };
  }
});

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http = require("http");
    var { Duplex } = require("stream");
    var { createHash: createHash3 } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash3("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// electron/main.ts
var import_electron2 = require("electron");
var import_node_fs7 = require("node:fs");
var import_node_path11 = require("node:path");

// electron/lib/agent-runtime.ts
var import_node_path3 = require("node:path");
var import_node_fs2 = require("node:fs");

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
};

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep2, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep2) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// ../../node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml/dist/stringify.js
var BARE_KEY = /^[a-z0-9-_]+$/i;
function extendedTypeOf(obj) {
  let type = typeof obj;
  if (type === "object") {
    if (Array.isArray(obj))
      return "array";
    if (typeof obj?.getUTCDate === "function" && obj instanceof Date)
      return "date";
    if (globalThis.Temporal && // check for the 'since' property as an early bailout that avoids running all 5 instanceof checks
    typeof obj?.since === "function" && (obj instanceof Temporal.Instant || obj instanceof Temporal.PlainDate || obj instanceof Temporal.PlainDateTime || obj instanceof Temporal.PlainTime || obj instanceof Temporal.ZonedDateTime)) {
      return "temporal";
    }
  }
  return type;
}
function isArrayOfTables(obj) {
  for (let i = 0; i < obj.length; i++) {
    if (extendedTypeOf(obj[i]) !== "object")
      return false;
  }
  return obj.length != 0;
}
function formatString(s) {
  return JSON.stringify(s).replace(/\x7f/g, "\\u007f");
}
function stringifyTemporal(temporal) {
  return temporal.toString({
    calendarName: "never",
    timeZoneName: "never"
  });
}
function stringifyValue(val, type, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  switch (type) {
    // @ts-expect-error -- intentional fallthrough case
    case "number":
      if (isNaN(val))
        return "nan";
      if (val === Infinity)
        return "inf";
      if (val === -Infinity)
        return "-inf";
      if (Number.isInteger(val) && (numberAsFloat || !Number.isSafeInteger(val)))
        return val.toFixed(1);
    case "bigint":
    case "boolean":
      return val.toString();
    case "string":
      return formatString(val);
    case "date":
      if (isNaN(val.getTime()))
        throw new TypeError("cannot serialize invalid date");
      return val.toISOString();
    case "object":
      return stringifyInlineTable(val, depth, numberAsFloat);
    case "array":
      return stringifyArray(val, depth, numberAsFloat);
    case "temporal":
      return stringifyTemporal(val);
  }
}
function stringifyInlineTable(obj, depth, numberAsFloat) {
  let keys = Object.keys(obj);
  if (keys.length === 0)
    return "{}";
  let res = "{ ";
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (i)
      res += ", ";
    res += BARE_KEY.test(k) ? k : formatString(k);
    res += " = ";
    res += stringifyValue(obj[k], extendedTypeOf(obj[k]), depth - 1, numberAsFloat);
  }
  return res + " }";
}
function stringifyArray(array, depth, numberAsFloat) {
  if (array.length === 0)
    return "[]";
  let res = "[ ";
  for (let i = 0; i < array.length; i++) {
    if (i)
      res += ", ";
    if (array[i] === null || array[i] === void 0) {
      throw new TypeError("arrays cannot contain null or undefined values");
    }
    res += stringifyValue(array[i], extendedTypeOf(array[i]), depth - 1, numberAsFloat);
  }
  return res + " ]";
}
function stringifyArrayTable(array, key, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let res = "";
  for (let i = 0; i < array.length; i++) {
    res += `${res && "\n"}[[${key}]]
`;
    res += stringifyTable(0, array[i], key, depth, numberAsFloat);
  }
  return res;
}
function stringifyTable(tableKey, obj, prefix, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let preamble = "";
  let tables = "";
  let keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (obj[k] !== null && obj[k] !== void 0) {
      let type = extendedTypeOf(obj[k]);
      if (type === "symbol" || type === "function") {
        throw new TypeError(`cannot serialize values of type '${type}'`);
      }
      let key = BARE_KEY.test(k) ? k : formatString(k);
      if (type === "array" && isArrayOfTables(obj[k])) {
        tables += (tables && "\n") + stringifyArrayTable(obj[k], prefix ? `${prefix}.${key}` : key, depth - 1, numberAsFloat);
      } else if (type === "object") {
        let tblKey = prefix ? `${prefix}.${key}` : key;
        tables += (tables && "\n") + stringifyTable(tblKey, obj[k], tblKey, depth - 1, numberAsFloat);
      } else {
        preamble += key;
        preamble += " = ";
        preamble += stringifyValue(obj[k], type, depth, numberAsFloat);
        preamble += "\n";
      }
    }
  }
  if (tableKey && (preamble || !tables))
    preamble = preamble ? `[${tableKey}]
${preamble}` : `[${tableKey}]`;
  return preamble && tables ? `${preamble}
${tables}` : preamble || tables;
}
function stringify(obj, { maxDepth = 1e3, numbersAsFloat = false } = {}) {
  if (extendedTypeOf(obj) !== "object") {
    throw new TypeError("stringify can only be called with an object");
  }
  let str = stringifyTable(0, obj, "", maxDepth, numbersAsFloat);
  if (str[str.length - 1] !== "\n")
    return str + "\n";
  return str;
}

// electron/lib/core.ts
var import_node_child_process = require("node:child_process");
var import_node_path = require("node:path");
var AGENT_RUNTIME_ENVIRONMENT_REFS = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
];
var INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS = [
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT"
];
var INHERITED_ENVIRONMENT_KEYS = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME"
];
var LOGIN_PATH_MARKER = "__HUMANTHREAD_LOGIN_PATH__";
var cachedLoginShellPath = null;
function desktopPlatformName() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "unknown";
}
function removeIndependentCredentialEnvironmentRefs(environmentRefs) {
  return environmentRefs.filter(
    (reference) => !INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS.includes(reference)
  );
}
function validateEnvironmentRefs(environmentRefs) {
  if (!Array.isArray(environmentRefs) || environmentRefs.length > 32) {
    throw new Error("Agent runtime environment references are invalid");
  }
  const unique = /* @__PURE__ */ new Set();
  for (const reference of environmentRefs) {
    const valid = typeof reference === "string" && reference.length > 0 && reference.length <= 128 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(reference) && AGENT_RUNTIME_ENVIRONMENT_REFS.includes(reference) && !unique.has(reference);
    if (!valid) {
      throw new Error("Agent runtime environment references are invalid");
    }
    unique.add(reference);
  }
}
function buildAgentProbePath(executable, inheritedPath) {
  const entries = [];
  const parent = (0, import_node_path.dirname)(executable);
  if (parent && parent !== ".") entries.push(parent);
  if (inheritedPath) {
    entries.push(...inheritedPath.split(import_node_path.delimiter).filter((entry) => entry.length > 0));
  }
  if (entries.length === 0) return void 0;
  return entries.join(import_node_path.delimiter);
}
function mergeCommandSearchPaths(...pathValues) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of pathValues) {
    for (const entry of (value ?? "").split(import_node_path.delimiter)) {
      const normalized = entry.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      entries.push(normalized);
    }
  }
  return entries.length > 0 ? entries.join(import_node_path.delimiter) : void 0;
}
function readLoginShellPath(environment = process.env, platform = process.platform) {
  if (platform === "win32") return void 0;
  const shell2 = environment.SHELL?.trim() || "/bin/zsh";
  try {
    const output = (0, import_node_child_process.execFileSync)(
      shell2,
      ["-ilc", `printf '${LOGIN_PATH_MARKER}%s' "$PATH"`],
      {
        encoding: "utf8",
        env: environment,
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3e3
      }
    );
    const markerIndex = output.lastIndexOf(LOGIN_PATH_MARKER);
    if (markerIndex < 0) return void 0;
    const resolved = output.slice(markerIndex + LOGIN_PATH_MARKER.length).trim();
    return resolved || void 0;
  } catch {
    return void 0;
  }
}
function resolveCommandSearchPath(inheritedPath = process.env.PATH) {
  if (cachedLoginShellPath === null) {
    cachedLoginShellPath = readLoginShellPath() ?? "";
  }
  return mergeCommandSearchPaths(
    inheritedPath,
    cachedLoginShellPath || void 0
  );
}
function buildInheritedCommandEnvironment(input) {
  const environment = {};
  const path = input.executablePath;
  if (path) environment.PATH = path;
  for (const key of [...INHERITED_ENVIRONMENT_KEYS, ...input.environmentRefs]) {
    const value = process.env[key];
    if (value !== void 0) environment[key] = value;
  }
  return environment;
}
function readBounded(stream, limit) {
  return new Promise((resolve2) => {
    const chunks = [];
    let retained = 0;
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (retained >= limit) return;
      const remaining = limit - retained;
      const slice = buffer.subarray(0, remaining);
      chunks.push(slice);
      retained += slice.length;
    });
    const finish = () => resolve2(Buffer.concat(chunks).toString("utf8"));
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });
}
function killProcessTree(processId) {
  if (process.platform === "win32") {
    try {
      (0, import_node_child_process.spawn)("taskkill", ["/PID", String(processId), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
    } catch {
    }
    return;
  }
  try {
    process.kill(-processId, "SIGKILL");
  } catch {
    try {
      process.kill(processId, "SIGKILL");
    } catch {
    }
  }
}
async function runCommandWithTimeout(input) {
  const executablePath = buildAgentProbePath(
    input.executable,
    resolveCommandSearchPath(process.env.PATH)
  );
  const environment = buildInheritedCommandEnvironment({
    executablePath,
    environmentRefs: input.environmentRefs
  });
  Object.assign(environment, input.environmentOverrides ?? {});
  const child = (0, import_node_child_process.spawn)(input.executable, input.args, {
    cwd: input.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  const stdoutPromise = readBounded(child.stdout, 8192);
  const stderrPromise = readBounded(child.stderr, 8192);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid !== void 0) killProcessTree(child.pid);
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }, input.timeoutMs);
  const exitCode = await new Promise((resolve2, reject) => {
    child.once("error", (error) => reject(new Error(`Failed to start ${input.operation}: ${error.message}`)));
    child.once("close", (code) => resolve2(code));
  }).finally(() => clearTimeout(timeout));
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;
  if (timedOut) {
    throw new Error(`${input.operation} timed out`);
  }
  return { exitCode, stdout, stderr };
}
function buildInterruptCommandSpec(platform, processId) {
  if (platform === "macos" || platform === "linux") {
    return { program: "kill", args: ["-TERM", `-${processId}`] };
  }
  if (platform === "windows") {
    return {
      program: "taskkill",
      args: ["/PID", String(processId), "/T", "/F"]
    };
  }
  return null;
}
function interruptProcess(processId) {
  const spec = buildInterruptCommandSpec(desktopPlatformName(), processId);
  if (!spec) {
    throw new Error("Managed command interruption is unavailable on this platform");
  }
  const child = (0, import_node_child_process.spawn)(spec.program, spec.args, { stdio: "ignore", windowsHide: true });
  child.once("error", () => {
  });
}
function escapeSingleQuotedShell(value) {
  return value.replaceAll("'", "'\\''");
}
function escapeAppleScriptString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
function escapeWindowsCmdArgument(value) {
  return value.replaceAll('"', '""');
}
function buildOpenCommand(path) {
  if (path.trim().length === 0) throw new Error("Project path is required.");
  if (process.platform === "darwin") {
    return { program: "open", args: [path], shell: "open" };
  }
  if (process.platform === "win32") {
    return { program: "explorer", args: [path], shell: "explorer" };
  }
  if (process.platform === "linux") {
    return { program: "xdg-open", args: [path], shell: "xdg-open" };
  }
  throw new Error("Unsupported platform for opening project paths.");
}
function buildTerminalLauncherCommand(path) {
  if (path.trim().length === 0) throw new Error("Project path is required.");
  if (process.platform === "darwin") {
    const shellCommand = `cd '${escapeSingleQuotedShell(path)}'`;
    const appleScript = `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`;
    return {
      program: "osascript",
      args: ["-e", 'tell application "Terminal" to activate', "-e", appleScript],
      shell: "osascript -> Terminal"
    };
  }
  if (process.platform === "win32") {
    const commandLine = `cd /d "${escapeWindowsCmdArgument(path)}"`;
    return {
      program: "cmd",
      args: ["/C", "start", "HumanThread", "cmd", "/K", commandLine],
      shell: "cmd /C start"
    };
  }
  if (process.platform === "linux") {
    const shellCommand = `cd '${escapeSingleQuotedShell(path)}'; exec "$SHELL"`;
    const launcher = [
      "if command -v x-terminal-emulator >/dev/null 2>&1; then",
      `  exec x-terminal-emulator -e sh -lc '${shellCommand}';`,
      "elif command -v gnome-terminal >/dev/null 2>&1; then",
      `  exec gnome-terminal -- sh -lc '${shellCommand}';`,
      "elif command -v konsole >/dev/null 2>&1; then",
      `  exec konsole -e sh -lc '${shellCommand}';`,
      "elif command -v xterm >/dev/null 2>&1; then",
      `  exec xterm -e sh -lc '${shellCommand}';`,
      "else",
      "  exit 127;",
      "fi"
    ].join(" ");
    return { program: "sh", args: ["-lc", launcher], shell: "linux terminal launcher" };
  }
  throw new Error("Unsupported platform for opening terminals.");
}
function buildManagedCommand(cwd, command) {
  if (cwd.trim().length === 0) throw new Error("Command working directory is required.");
  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) throw new Error("Command is required.");
  if (process.platform === "win32") {
    return {
      program: "cmd",
      args: ["/C", normalizedCommand],
      cwd,
      shell: "cmd /C"
    };
  }
  return {
    program: "sh",
    args: ["-lc", normalizedCommand],
    cwd,
    shell: "sh -lc"
  };
}
function buildRestoreSessionCommand(cwd, sessionName, sessionType) {
  if (cwd.trim().length === 0) throw new Error("Command working directory is required.");
  const normalizedSessionName = sessionName.trim();
  if (normalizedSessionName.length === 0) throw new Error("Session name is required.");
  const normalizedSessionType = sessionType.trim();
  if (normalizedSessionType.length === 0) throw new Error("Session type is required.");
  if (process.platform === "win32") {
    return buildTerminalLauncherCommand(cwd);
  }
  if (normalizedSessionType !== "tmux") {
    throw new Error(`Unsupported session type for restore: ${normalizedSessionType}`);
  }
  const sessionCommand = `tmux attach -t '${escapeSingleQuotedShell(normalizedSessionName)}'`;
  return {
    program: "sh",
    args: ["-lc", sessionCommand],
    cwd,
    shell: "sh -lc"
  };
}
function spawnManagedSpec(spec, input) {
  const stdio = input.ignoreOutput ? "ignore" : "pipe";
  return (0, import_node_child_process.spawn)(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: [input.ignoreOutput ? "ignore" : "pipe", stdio, stdio],
    detached: process.platform !== "win32",
    windowsHide: true
  });
}

// electron/lib/local-model.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");
var CREDENTIAL_SCHEMA_VERSION = 1;
var MODEL_CATALOG_SCHEMA_VERSION = 1;
var MODEL_SELECTION_SCHEMA_VERSION = 2;
var LEGACY_MODEL_SELECTION_SCHEMA_VERSION = 1;
var DEFAULT_REASONING_EFFORT = "high";
var MAX_JSON_BYTES = 8 * 1024 * 1024;
var HEX_DIGEST_LENGTH = 32;
function invalid(message) {
  return new Error(message);
}
function isNotFound(error) {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}
function validHexDigest(value) {
  return value.length === HEX_DIGEST_LENGTH && /^[0-9a-f]+$/u.test(value);
}
function validLocalName(value, maximum) {
  return value.length > 0 && value.length <= maximum && !/[\u0000-\u001F\u007F]/u.test(value);
}
function normalizeCredential(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4096 || /[\u0000-\u001F\u007F]/u.test(trimmed)) {
    throw invalid("Credential input is invalid");
  }
  return trimmed;
}
function validateSelection(value) {
  if (!validHexDigest(value.siteId) || !validHexDigest(value.modelKey)) {
    throw invalid("Local model selection is invalid");
  }
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(value.reasoningEffort)) {
    throw invalid("Local model reasoning effort is invalid");
  }
}
function validateSite(value) {
  if (!validHexDigest(value.siteId) || !validLocalName(value.name, 128) || !["codex_environment", "openai_compatible", "ollama", "lmstudio"].includes(value.adapter) || !["environment", "independent"].includes(value.credentialSource) || !["ready", "needs_revalidation", "connection_failed", "untested"].includes(value.status)) {
    throw invalid("Local model site is invalid");
  }
  if (value.adapter === "codex_environment") {
    if (value.baseUrl !== null) {
      throw invalid("Codex environment sites cannot set a base URL");
    }
    if (value.credentialSource !== "environment") {
      throw invalid("Codex environment sites must use environment credentials");
    }
  } else if (value.baseUrl === null || value.baseUrl.length > 2048 || /[\u0000-\u001F\u007F]/u.test(value.baseUrl) || !value.baseUrl.startsWith("http://") && !value.baseUrl.startsWith("https://")) {
    throw invalid("Model site base URL is invalid");
  }
  if (value.credentialSource === "independent") {
    if (value.credentialRef === null || !validHexDigest(value.credentialRef)) {
      throw invalid("Independent model site credential reference is invalid");
    }
  } else if (value.credentialRef !== null) {
    throw invalid("Environment model sites cannot set a credential reference");
  }
}
function validateSitesDocument(value) {
  if (value.schemaVersion !== MODEL_SELECTION_SCHEMA_VERSION || value.sites.length > 256) {
    throw invalid("Local model sites configuration is corrupted");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const site of value.sites) {
    validateSite(site);
    if (ids.has(site.siteId)) {
      throw invalid("Local model site identifiers must be unique");
    }
    ids.add(site.siteId);
  }
  if (value.accountDefault !== null) {
    validateSelection(value.accountDefault);
  }
}
function validateAccountDefault(selection, sites, catalog) {
  if (selection === null) return;
  validateSelection(selection);
  if (!sites.sites.some((site) => site.siteId === selection.siteId)) {
    throw invalid("Account default model site is unavailable");
  }
  const siteCatalog = catalog.sites[selection.siteId];
  if (siteCatalog === void 0) {
    throw invalid("Account default model catalog is unavailable");
  }
  if (!siteCatalog.models.some((model) => model.modelKey === selection.modelKey)) {
    throw invalid("Account default model is unavailable");
  }
}
function validateCatalogDocument(value) {
  if (value.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION || Object.keys(value.sites).length > 256) {
    throw invalid("Local model catalog is corrupted");
  }
  for (const [siteId, catalog] of Object.entries(value.sites)) {
    if (!validHexDigest(siteId) || catalog.models.length > 1e4 || catalog.refreshedAt.length === 0) {
      throw invalid("Local model catalog is corrupted");
    }
    const keys = /* @__PURE__ */ new Set();
    for (const model of catalog.models) {
      if (!validHexDigest(model.modelKey) || !validLocalName(model.name, 512) || !validLocalName(model.label, 256) || keys.has(model.modelKey)) {
        throw invalid("Local model catalog is corrupted");
      }
      keys.add(model.modelKey);
    }
  }
}
function validateRoutingDocument(value) {
  if (value.schemaVersion !== MODEL_SELECTION_SCHEMA_VERSION || Object.keys(value.loops).length > 1e4) {
    throw invalid("Local Loop model routing is corrupted");
  }
  for (const [loopId, entry] of Object.entries(value.loops)) {
    if (!validLocalName(loopId, 128) || Object.keys(entry.nodes).length > 1e4) {
      throw invalid("Local Loop model routing is corrupted");
    }
    if (entry.default !== null) {
      validateSelection(entry.default);
    }
    for (const [nodeId, selection] of Object.entries(entry.nodes)) {
      if (!validLocalName(nodeId, 128)) {
        throw invalid("Local Loop model routing is corrupted");
      }
      validateSelection(selection);
    }
  }
}
function normalizeDeploymentOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw invalid("Deployment origin is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0 || parsed.pathname !== "" && parsed.pathname !== "/") {
    throw invalid("Deployment origin is invalid");
  }
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
  return `${parsed.protocol.slice(0, -1).toLowerCase()}://${parsed.hostname.toLowerCase()}${port}`;
}
function accountDirectory(deploymentOrigin, userId) {
  const origin = normalizeDeploymentOrigin(deploymentOrigin);
  const user = userId.trim();
  if (user.length === 0 || user.length > 256 || /[\u0000-\u001F\u007F]/u.test(user)) {
    throw invalid("User ID is invalid");
  }
  const scope = (0, import_node_crypto.createHash)("sha256").update(origin).update("\0").update(user).digest("hex");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? (0, import_node_os.homedir)();
  if (!home) {
    throw invalid("User home directory is unavailable");
  }
  return (0, import_node_path2.join)(home, ".humanthread", "accounts", scope);
}
function sourceCodexConfigPath() {
  const home = process.env.CODEX_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? (0, import_node_os.homedir)();
  if (!home) throw invalid("User home directory is unavailable");
  return process.env.CODEX_HOME ? (0, import_node_path2.join)(home, "config.toml") : (0, import_node_path2.join)(home, ".codex", "config.toml");
}
function projectIsolatedCodexConfig(source) {
  const projected = {};
  if (source !== null) {
    let parsed;
    try {
      parsed = parse(source.trimStart());
    } catch {
      throw invalid("Codex configuration is invalid");
    }
    if (parsed.mcp_servers !== void 0) {
      projected.mcp_servers = parsed.mcp_servers;
    }
  }
  if (Object.keys(projected).length === 0) return "";
  return `${stringify(projected).trimEnd()}
`;
}
function rejectSymlink(path) {
  let metadata;
  try {
    metadata = (0, import_node_fs.lstatSync)(path);
  } catch (error) {
    if (isNotFound(error)) return;
    throw new Error(`Failed to inspect local configuration: ${error.message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw invalid("Symlinks are forbidden in local configuration");
  }
}
function restrictDirectory(path) {
  if (process.platform === "win32") return;
  try {
    (0, import_node_fs.chmodSync)(path, 448);
  } catch {
    throw new Error("Failed to secure local configuration directory");
  }
}
function restrictFile(path) {
  if (process.platform === "win32") return;
  try {
    (0, import_node_fs.chmodSync)(path, 384);
  } catch {
    throw new Error("Failed to secure local configuration file");
  }
}
function atomicWriteText(path, content) {
  rejectSymlink(path);
  const parent = (0, import_node_path2.dirname)(path);
  if (parent === path) throw invalid("Local configuration file has no parent");
  const temporary = (0, import_node_path2.join)(parent, `.config.toml.${process.hrtime.bigint()}.tmp`);
  let descriptor;
  try {
    descriptor = (0, import_node_fs.openSync)(temporary, "wx");
  } catch (error) {
    throw new Error(`Failed to create isolated Codex configuration: ${error.message}`);
  }
  restrictFile(temporary);
  try {
    (0, import_node_fs.writeSync)(descriptor, content);
    (0, import_node_fs.fsyncSync)(descriptor);
  } catch (error) {
    (0, import_node_fs.closeSync)(descriptor);
    (0, import_node_fs.rmSync)(temporary, { force: true });
    throw new Error(`Failed to write isolated Codex configuration: ${error.message}`);
  }
  (0, import_node_fs.closeSync)(descriptor);
  try {
    (0, import_node_fs.renameSync)(temporary, path);
  } catch (error) {
    (0, import_node_fs.rmSync)(temporary, { force: true });
    throw new Error(`Failed to replace isolated Codex configuration: ${error.message}`);
  }
  restrictFile(path);
}
function prepareIsolatedCodexHome(deploymentOrigin, userId) {
  const account = accountDirectory(deploymentOrigin, userId);
  prepareAccountDirectory(account);
  const codexHome = (0, import_node_path2.join)(account, "codex-home");
  rejectSymlink(codexHome);
  try {
    (0, import_node_fs.mkdirSync)(codexHome, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create isolated Codex home: ${error.message}`);
  }
  restrictDirectory(codexHome);
  const sourcePath = sourceCodexConfigPath();
  let source = null;
  try {
    const metadata = (0, import_node_fs.statSync)(sourcePath);
    if (metadata.size > MAX_JSON_BYTES) {
      throw invalid("Codex configuration is too large");
    }
    source = (0, import_node_fs.readFileSync)(sourcePath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) {
      if (error instanceof Error && error.message === "Codex configuration is too large") throw error;
      throw new Error(`Failed to inspect Codex configuration: ${error.message}`);
    }
  }
  const projected = projectIsolatedCodexConfig(source);
  atomicWriteText((0, import_node_path2.join)(codexHome, "config.toml"), projected);
  return codexHome;
}
function writeIsolatedChecklistMcpConfig(codexHome, url, headers) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid("Checklist MCP URL is invalid");
  }
  const headerEntries = Object.entries(headers);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0 || headerEntries.length === 0 || headerEntries.length > 8 || headerEntries.some(
    ([name, value]) => name.length === 0 || name.length > 128 || !/^[A-Za-z0-9-]+$/u.test(name) || value.length === 0 || value.length > 4096 || /[\u0000-\u001F\u007F]/u.test(value)
  )) {
    throw invalid("Checklist MCP configuration is invalid");
  }
  const content = stringify({
    mcp_servers: {
      humanthread_checklist: {
        url: parsed.toString(),
        http_headers: headers
      }
    }
  });
  atomicWriteText((0, import_node_path2.join)(codexHome, "config.toml"), `${content.trimEnd()}
`);
}
function prepareAccountDirectory(directory) {
  const accountRoot = (0, import_node_path2.dirname)(directory);
  const root = (0, import_node_path2.dirname)(accountRoot);
  if (root === accountRoot || accountRoot === directory) {
    throw invalid("Local configuration path is invalid");
  }
  for (const path of [root, accountRoot, directory]) {
    rejectSymlink(path);
    try {
      (0, import_node_fs.mkdirSync)(path, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create local configuration directory: ${error.message}`);
    }
    restrictDirectory(path);
  }
}
function documentPath(directory, name) {
  if (!["credentials.json", "model-sites.json", "model-catalog.json", "loop-model-routing.json"].includes(name)) {
    throw invalid("Local configuration filename is invalid");
  }
  const path = (0, import_node_path2.join)(directory, name);
  rejectSymlink(path);
  return path;
}
function readJsonContent(path) {
  rejectSymlink(path);
  let metadata;
  try {
    metadata = (0, import_node_fs.statSync)(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(`Failed to inspect local configuration: ${error.message}`);
  }
  if (metadata.size > MAX_JSON_BYTES) {
    throw invalid("Local configuration file is too large");
  }
  try {
    return (0, import_node_fs.readFileSync)(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read local configuration: ${error.message}`);
  }
}
function atomicWriteJson(path, value) {
  rejectSymlink(path);
  const parent = (0, import_node_path2.dirname)(path);
  if (parent === path) throw invalid("Local configuration file has no parent");
  rejectSymlink(parent);
  const content = JSON.stringify(value, null, 2);
  const temporary = (0, import_node_path2.join)(parent, `.${(0, import_node_path2.basename)(path)}.${process.hrtime.bigint()}.tmp`);
  let descriptor;
  try {
    descriptor = (0, import_node_fs.openSync)(temporary, "wx");
  } catch (error) {
    throw new Error(`Failed to create local configuration temporary file: ${error.message}`);
  }
  restrictFile(temporary);
  try {
    (0, import_node_fs.writeSync)(descriptor, content);
    (0, import_node_fs.fsyncSync)(descriptor);
  } catch (error) {
    (0, import_node_fs.closeSync)(descriptor);
    (0, import_node_fs.rmSync)(temporary, { force: true });
    throw new Error(`Failed to write local configuration: ${error.message}`);
  }
  (0, import_node_fs.closeSync)(descriptor);
  try {
    (0, import_node_fs.renameSync)(temporary, path);
  } catch (error) {
    (0, import_node_fs.rmSync)(temporary, { force: true });
    throw new Error(`Failed to replace local configuration: ${error.message}`);
  }
  restrictFile(path);
}
function emptySites() {
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, sites: [], accountDefault: null };
}
function emptyCatalog() {
  return { schemaVersion: MODEL_CATALOG_SCHEMA_VERSION, sites: {} };
}
function emptyRouting() {
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, loops: {} };
}
function emptyCredentials() {
  return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, credentials: {} };
}
function readJson(path, fallback) {
  const content = readJsonContent(path);
  if (content === null) return fallback;
  try {
    return JSON.parse(content);
  } catch {
    throw invalid("Local configuration file is corrupted");
  }
}
function readSchemaVersion(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalid("Local model configuration is invalid");
  }
  if (typeof parsed.schemaVersion !== "number") {
    throw invalid("Local model configuration is invalid");
  }
  return parsed.schemaVersion;
}
function migrateSelection(value, reasoningEffort) {
  if (typeof value.siteId !== "string" || typeof value.modelKey !== "string") {
    throw invalid("Local model configuration is invalid");
  }
  return { siteId: value.siteId, modelKey: value.modelKey, reasoningEffort };
}
function migrateSitesDocument(value) {
  const accountDefault = value.accountDefault;
  return {
    schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
    sites: Array.isArray(value.sites) ? value.sites : [],
    accountDefault: accountDefault && typeof accountDefault === "object" ? migrateSelection(accountDefault, DEFAULT_REASONING_EFFORT) : null
  };
}
function migrateRoutingDocument(value) {
  const loops = {};
  if (value.loops && typeof value.loops === "object") {
    for (const [loopId, rawEntry] of Object.entries(value.loops)) {
      const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
      const defaultSelection = entry.default;
      const nodes = {};
      if (entry.nodes && typeof entry.nodes === "object") {
        for (const [nodeId, rawSelection] of Object.entries(entry.nodes)) {
          nodes[nodeId] = migrateSelection(
            rawSelection ?? {},
            DEFAULT_REASONING_EFFORT
          );
        }
      }
      loops[loopId] = {
        default: defaultSelection && typeof defaultSelection === "object" ? migrateSelection(defaultSelection, DEFAULT_REASONING_EFFORT) : null,
        nodes
      };
    }
  }
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, loops };
}
function readModelSitesDocument(path) {
  const content = readJsonContent(path);
  if (content === null) return emptySites();
  const schemaVersion = readSchemaVersion(content);
  if (schemaVersion === MODEL_SELECTION_SCHEMA_VERSION) {
    const document = JSON.parse(content);
    validateSitesDocument(document);
    return document;
  }
  if (schemaVersion === LEGACY_MODEL_SELECTION_SCHEMA_VERSION) {
    const document = migrateSitesDocument(JSON.parse(content));
    validateSitesDocument(document);
    atomicWriteJson(path, document);
    return document;
  }
  throw invalid("Local model configuration version is unsupported");
}
function readCatalogDocument(path) {
  const document = readJson(path, emptyCatalog());
  validateCatalogDocument(document);
  return document;
}
function readRoutingDocument(path) {
  const content = readJsonContent(path);
  if (content === null) return emptyRouting();
  const schemaVersion = readSchemaVersion(content);
  if (schemaVersion === MODEL_SELECTION_SCHEMA_VERSION) {
    const document = JSON.parse(content);
    validateRoutingDocument(document);
    return document;
  }
  if (schemaVersion === LEGACY_MODEL_SELECTION_SCHEMA_VERSION) {
    const document = migrateRoutingDocument(JSON.parse(content));
    validateRoutingDocument(document);
    atomicWriteJson(path, document);
    return document;
  }
  throw invalid("Local model configuration version is unsupported");
}
function accountDocumentPath(deploymentOrigin, userId, name) {
  const directory = accountDirectory(deploymentOrigin, userId);
  prepareAccountDirectory(directory);
  return documentPath(directory, name);
}
function nowIso8601() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function getAgentCredentialStatus(input) {
  if (!validHexDigest(input.credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const record2 = document.credentials[input.credentialRef];
  return {
    credentialRef: input.credentialRef,
    kind: "openai_api_key",
    configured: record2 !== void 0 && record2.kind === "openai_api_key" && record2.apiKey.length > 0,
    updatedAt: record2?.updatedAt ?? null
  };
}
function setAgentCredential(input) {
  if (!validHexDigest(input.credentialRef) || input.kind !== "openai_api_key") {
    throw invalid("Credential input is invalid");
  }
  const key = normalizeCredential(input.apiKey);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const updatedAt = nowIso8601();
  document.credentials[input.credentialRef] = { kind: input.kind, apiKey: key, updatedAt };
  atomicWriteJson(path, document);
  return { credentialRef: input.credentialRef, kind: input.kind, configured: true, updatedAt };
}
function deleteAgentCredential(input) {
  if (!validHexDigest(input.credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  delete document.credentials[input.credentialRef];
  if (Object.keys(document.credentials).length === 0) {
    rejectSymlink(path);
    (0, import_node_fs.rmSync)(path, { force: true });
  } else {
    atomicWriteJson(path, document);
  }
  return {
    credentialRef: input.credentialRef,
    kind: "openai_api_key",
    configured: false,
    updatedAt: null
  };
}
function readAgentCredential(deploymentOrigin, userId, credentialRef) {
  if (!validHexDigest(credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(deploymentOrigin, userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const record2 = document.credentials[credentialRef];
  if (record2 === void 0) {
    throw invalid("Local credential is not configured");
  }
  if (record2.kind !== "openai_api_key" || record2.apiKey.length === 0) {
    throw invalid("Local credential is invalid");
  }
  return record2.apiKey;
}
function listModelSites(input) {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  return readModelSitesDocument(path);
}
function saveModelSite(input) {
  validateSite(input.site);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const catalog = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  const document = readModelSitesDocument(path);
  const existingIndex = document.sites.findIndex((value) => value.siteId === input.site.siteId);
  if (existingIndex >= 0) {
    document.sites[existingIndex] = input.site;
  } else {
    document.sites.push(input.site);
  }
  validateAccountDefault(input.accountDefault, document, catalog);
  document.accountDefault = input.accountDefault;
  validateSitesDocument(document);
  atomicWriteJson(path, document);
  return document;
}
function saveModelDefaults(input) {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const catalog = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  const document = readModelSitesDocument(path);
  validateAccountDefault(input.accountDefault, document, catalog);
  document.accountDefault = input.accountDefault;
  validateSitesDocument(document);
  atomicWriteJson(path, document);
  return document;
}
function siteIsReferenced(siteId, sites, routing) {
  return sites.accountDefault?.siteId === siteId || Object.values(routing.loops).some(
    (entry) => entry.default?.siteId === siteId || Object.values(entry.nodes).some((selection) => selection.siteId === siteId)
  );
}
function deleteModelSite(input) {
  if (!validHexDigest(input.siteId)) {
    throw invalid("Model site identifier is invalid");
  }
  const sitesPath = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const routingPath = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  const sites = readModelSitesDocument(sitesPath);
  const routing = readRoutingDocument(routingPath);
  if (siteIsReferenced(input.siteId, sites, routing)) {
    throw invalid("Model site is referenced by local defaults or Loop nodes");
  }
  sites.sites = sites.sites.filter((site) => site.siteId !== input.siteId);
  validateSitesDocument(sites);
  atomicWriteJson(sitesPath, sites);
  return sites;
}
function getModelCatalog(input) {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-catalog.json");
  return readCatalogDocument(path);
}
function saveModelCatalog(input) {
  validateCatalogDocument(input.catalog);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-catalog.json");
  atomicWriteJson(path, input.catalog);
  return input.catalog;
}
function getLoopModelRouting(input) {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  return readRoutingDocument(path);
}
function saveLoopModelRouting(input) {
  validateRoutingDocument(input.routing);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  atomicWriteJson(path, input.routing);
  return input.routing;
}
function md5Hex(value) {
  return (0, import_node_crypto.createHash)("md5").update(value).digest("hex");
}
function modelDiscoveryEndpoint(site) {
  if (!site.baseUrl) {
    throw invalid("Model site base URL is unavailable");
  }
  let parsed;
  try {
    parsed = new URL(site.baseUrl);
  } catch {
    throw invalid("Model site URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw invalid("Model site URL is invalid");
  }
  const suffix = site.adapter === "ollama" ? "api/tags" : "models";
  const basePath = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = `${basePath}/${suffix}`;
  return parsed.toString();
}
function modelDiscoveryCredential(input) {
  if (input.credentialOverride !== void 0) {
    return normalizeCredential(input.credentialOverride);
  }
  if (input.site.credentialSource === "independent") {
    if (!input.site.credentialRef) {
      throw invalid("Model site credential is unavailable");
    }
    return readAgentCredential(input.deploymentOrigin, input.userId, input.site.credentialRef);
  }
  const value = process.env.OPENAI_API_KEY ?? process.env.OLLAMA_API_KEY;
  return value !== void 0 && value.trim().length > 0 ? value : null;
}
async function fetchModelCatalog(input) {
  const headers = { Accept: "application/json" };
  if (input.credential !== null) {
    headers.Authorization = `Bearer ${input.credential.trim()}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1e4);
  let response;
  try {
    response = await input.fetch(input.endpoint, { headers, signal: controller.signal });
  } catch {
    throw invalid("Model site discovery failed");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw invalid("Model site discovery failed");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > 2 * 1024 * 1024) {
    throw invalid("Model catalog response is too large");
  }
  return body;
}
function jsonStringField(value, fields, maximum) {
  if (!value || typeof value !== "object") return null;
  const object = value;
  for (const field of fields) {
    const candidate = object[field];
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || trimmed.length > maximum || /[\u0000-\u001F\u007F]/u.test(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return null;
}
function normalizeDiscoveredModels(site, payload) {
  const object = payload && typeof payload === "object" ? payload : null;
  const collection = object ? site.adapter === "ollama" ? object.models : object.data : void 0;
  if (!Array.isArray(collection)) {
    throw invalid("Model catalog response is invalid");
  }
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  for (const item of collection) {
    const name = jsonStringField(item, ["id", "name", "model"], 512);
    if (name === null || seen.has(name)) continue;
    seen.add(name);
    const label = jsonStringField(item, ["name"], 256) ?? name;
    const keyInput = Buffer.concat([Buffer.from(site.siteId, "utf8"), Buffer.from([0]), Buffer.from(name, "utf8")]);
    models.push({ modelKey: md5Hex(keyInput), name, label, manual: false });
    if (models.length >= 1e4) {
      throw invalid("Model catalog contains too many models");
    }
  }
  const catalog = { refreshedAt: nowIso8601(), models };
  validateCatalogDocument({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    sites: { [site.siteId]: catalog }
  });
  return catalog;
}
async function discoverModelSite(input) {
  if (input.site.adapter === "codex_environment") {
    throw invalid("Codex environment model discovery is not supported");
  }
  const endpoint = modelDiscoveryEndpoint(input.site);
  const credential = modelDiscoveryCredential({
    deploymentOrigin: input.deploymentOrigin,
    userId: input.userId,
    site: input.site,
    ...input.credentialOverride === void 0 ? {} : { credentialOverride: input.credentialOverride }
  });
  const body = await fetchModelCatalog({ endpoint, credential, fetch: input.fetch });
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw invalid("Model catalog response is invalid");
  }
  return normalizeDiscoveredModels(input.site, payload);
}
async function testAndRefreshModelSite(input) {
  validateSite(input.site);
  const credential = input.credential !== void 0 ? normalizeCredential(input.credential) : void 0;
  const catalog = input.catalog !== void 0 ? input.catalog : await discoverModelSite({
    deploymentOrigin: input.deploymentOrigin,
    userId: input.userId,
    site: input.site,
    ...credential === void 0 ? {} : { credentialOverride: credential },
    fetch: input.fetch
  });
  validateCatalogDocument({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    sites: { [input.site.siteId]: catalog }
  });
  const document = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  document.sites[input.site.siteId] = catalog;
  saveModelCatalog({
    deploymentOrigin: input.deploymentOrigin,
    userId: input.userId,
    catalog: document
  });
  return catalog;
}

// electron/lib/agent-runtime.ts
function providerExecutableNames(provider) {
  if (provider === "codex") {
    return process.platform === "win32" ? ["codex", "codex.cmd", "codex.exe"] : ["codex"];
  }
  if (provider === "claude") {
    return process.platform === "win32" ? ["claude", "claude.cmd", "claude.exe"] : ["claude"];
  }
  throw new Error("Agent runtime Provider is invalid");
}
function providerPackageName(provider) {
  if (provider === "codex") return "@openai/codex";
  if (provider === "claude") return "@anthropic-ai/claude-code";
  throw new Error("Agent runtime Provider is invalid");
}
function npmExecutableName() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
function validateAgentExecutable(provider, command) {
  const expectedNames = providerExecutableNames(provider);
  if (command.length === 0 || command.length > 1024 || /[\u0000-\u001F\u007F]/u.test(command)) {
    throw new Error("Agent runtime executable is invalid");
  }
  if (!(0, import_node_path3.isAbsolute)(command) && (command.includes("/") || command.includes("\\"))) {
    throw new Error("Relative Agent runtime executable paths are forbidden");
  }
  const fileName = (0, import_node_path3.basename)(command);
  if (!expectedNames.some((expected) => fileName.toLowerCase() === expected.toLowerCase())) {
    throw new Error("Agent runtime executable is not allowlisted for the Provider");
  }
}
function providerExecutablePathCandidates(provider, command) {
  validateAgentExecutable(provider, command);
  if ((0, import_node_path3.isAbsolute)(command)) return [command];
  if (process.platform !== "win32") return [command];
  const requestedName = (0, import_node_path3.basename)(command);
  const allowedNames = providerExecutableNames(provider);
  const requestedHasExtension = (0, import_node_path3.extname)(requestedName).length > 0;
  const names = requestedHasExtension ? [requestedName] : allowedNames.filter((name) => (0, import_node_path3.extname)(name).length > 0);
  if (!names.some((name) => name.toLowerCase() === requestedName.toLowerCase())) {
    names.push(requestedName);
  }
  return names;
}
function windowsCodexNativeCandidates(launcherDirectory) {
  const isArm = process.arch === "arm64";
  const platformPackage = isArm ? "codex-win32-arm64" : "codex-win32-x64";
  const targetTriple = isArm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const openaiPackages = (0, import_node_path3.join)(launcherDirectory, "node_modules", "@openai");
  const suffix = (0, import_node_path3.join)("vendor", targetTriple, "bin", "codex.exe");
  return [
    (0, import_node_path3.join)(openaiPackages, "codex", "node_modules", "@openai", platformPackage, suffix),
    (0, import_node_path3.join)(openaiPackages, platformPackage, suffix)
  ];
}
function resolveWindowsCodexNative(launcherDirectory) {
  return windowsCodexNativeCandidates(launcherDirectory).find((candidate) => fileExists(candidate));
}
function fileExists(path) {
  try {
    return (0, import_node_fs2.statSync)(path).isFile();
  } catch {
    return false;
  }
}
function resolveAgentExecutableIn(input) {
  const candidates = providerExecutablePathCandidates(input.provider, input.command);
  if ((0, import_node_path3.isAbsolute)(input.command)) {
    if (process.platform === "win32" && input.provider === "codex" && ((0, import_node_path3.extname)(input.command) === "" || (0, import_node_path3.extname)(input.command).toLowerCase() === ".cmd")) {
      return fileExists(input.command) ? resolveWindowsCodexNative((0, import_node_path3.dirname)(input.command)) : void 0;
    }
    return candidates.find((candidate) => fileExists(candidate));
  }
  const directories = (input.pathValue ?? "").split(import_node_path3.delimiter).filter((entry) => entry.length > 0);
  if (process.platform === "win32" && input.provider === "codex") {
    if (input.appData) directories.unshift((0, import_node_path3.join)(input.appData, "npm"));
    for (const directory of directories) {
      const native = resolveWindowsCodexNative(directory);
      if (native) return native;
    }
    return directories.map((directory) => (0, import_node_path3.join)(directory, "codex.exe")).find((candidate) => fileExists(candidate));
  }
  for (const directory of directories) {
    for (const candidate of candidates) {
      const path = (0, import_node_path3.join)(directory, candidate);
      if (fileExists(path)) return path;
    }
  }
  return void 0;
}
function resolveAgentExecutable(provider, command) {
  return resolveAgentExecutableIn({
    provider,
    command,
    pathValue: resolveCommandSearchPath(process.env.PATH),
    appData: process.env.APPDATA
  });
}
function resolveCodexExecutable(command) {
  const executable = resolveAgentExecutable("codex", command);
  if (executable) return executable;
  if (command !== "codex") {
    throw new Error("Configured Codex executable was not found");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("Codex executable was not found");
  const versions = (0, import_node_path3.join)(home, ".nvm", "versions", "node");
  let entries;
  try {
    entries = (0, import_node_fs2.readdirSync)(versions);
  } catch {
    throw new Error("Codex executable was not found");
  }
  const candidates = entries.map((entry) => (0, import_node_path3.join)(versions, entry, process.platform === "win32" ? "codex.exe" : "bin/codex")).filter((candidate) => fileExists(candidate)).sort();
  const resolved = candidates[candidates.length - 1];
  if (!resolved) throw new Error("Codex executable was not found");
  return resolved;
}
function extractSemanticVersion(output) {
  for (const rawPart of output.split(/[\s,()]+/u)) {
    const part = rawPart.replace(/^[^A-Za-z0-9.+-]+|[^A-Za-z0-9.+-]+$/gu, "");
    const core = part.split(/[-+]/u)[0] ?? "";
    const segments = core.split(".");
    if (segments.length === 3 && segments.every((segment) => segment.length > 0 && /^\d+$/u.test(segment))) {
      return part;
    }
  }
  return null;
}
function sanitizeRuntimeProbe(provider, exitCode, stdout, stderr) {
  const normalized = `${stdout}
${stderr}`.toLowerCase();
  const unauthenticated = [
    "login required",
    "not logged in",
    "unauthenticated",
    "authentication required"
  ].some((marker) => normalized.includes(marker));
  const [status, authentication] = exitCode === 0 ? ["ready", "authenticated"] : unauthenticated ? ["unauthenticated", "unauthenticated"] : ["missing", "unknown"];
  return {
    provider,
    status,
    semanticVersion: extractSemanticVersion(normalized),
    authentication,
    capabilities: []
  };
}
function runProbeCommand(executable, args, environmentRefs, environmentOverrides) {
  return runCommandWithTimeout({
    executable,
    args,
    environmentRefs,
    environmentOverrides,
    timeoutMs: 5e3,
    operation: "Agent runtime probe"
  });
}
async function probeAgentRuntimeImpl(input) {
  validateEnvironmentRefs(input.environmentRefs);
  if ((input.credential !== void 0 || input.credentialContext !== void 0) && input.provider !== "codex") {
    throw new Error("Independent credentials are only supported for Codex");
  }
  const environmentOverrides = {};
  if (input.credential !== void 0) {
    const value = input.credential.trim();
    if (value.length === 0 || value.length > 4096 || /[\u0000-\u001F\u007F]/u.test(value)) {
      throw new Error("Codex credential input is invalid");
    }
    environmentOverrides.OPENAI_API_KEY = value;
  } else if (input.credentialContext !== void 0) {
    environmentOverrides.OPENAI_API_KEY = readAgentCredential(
      input.credentialContext.deploymentOrigin,
      input.credentialContext.userId,
      input.credentialContext.credentialRef
    );
  }
  const executable = resolveAgentExecutable(input.provider, input.command);
  if (!executable) {
    return {
      provider: input.provider,
      status: "missing",
      semanticVersion: null,
      authentication: "unknown",
      capabilities: []
    };
  }
  const version = await runProbeCommand(executable, ["--version"], input.environmentRefs, environmentOverrides);
  if (version.exitCode !== 0) {
    return sanitizeRuntimeProbe(input.provider, version.exitCode, version.stdout, version.stderr);
  }
  const authArgs = input.provider === "codex" ? ["login", "status"] : ["auth", "status"];
  const authentication = await runProbeCommand(executable, authArgs, input.environmentRefs, environmentOverrides);
  const authenticated = authentication.exitCode === 0;
  return {
    provider: input.provider,
    status: authenticated ? "ready" : "unauthenticated",
    semanticVersion: extractSemanticVersion(`${version.stdout}
${version.stderr}`),
    authentication: authenticated ? "authenticated" : "unauthenticated",
    capabilities: authenticated ? ["approvals", "session_resume", "structured_result"] : []
  };
}
async function installAgentRuntimeImpl(input) {
  validateEnvironmentRefs(input.environmentRefs);
  const packageName = providerPackageName(input.provider);
  const installEnvironmentRefs = input.environmentRefs.filter(
    (reference) => ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"].includes(reference)
  );
  const result = await runCommandWithTimeout({
    executable: npmExecutableName(),
    args: ["install", "--global", packageName],
    environmentRefs: installEnvironmentRefs,
    timeoutMs: 3e5,
    operation: "Agent runtime installation"
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to install ${input.provider} runtime (exit code ${result.exitCode === null ? "unknown" : String(result.exitCode)})`
    );
  }
  return { provider: input.provider, packageName, status: "installed" };
}
function codexLocalModelProviderBaseUrl(args) {
  if (args[1] !== "--config") return null;
  const expected = [
    [1, "--config"],
    [2, 'model_provider="humanthread_local"'],
    [3, "--config"],
    [4, 'model_providers.humanthread_local.name="HumanThread Desktop"'],
    [5, "--config"],
    [7, "--config"],
    [8, 'model_providers.humanthread_local.env_key="OPENAI_API_KEY"'],
    [9, "--config"],
    [10, 'model_providers.humanthread_local.wire_api="responses"'],
    [11, "--config"],
    [12, "model_providers.humanthread_local.requires_openai_auth=false"]
  ];
  if (args.length <= 13 || args[0] !== "exec" || expected.some(([index, value]) => args[index] !== value)) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const rawBaseUrl = args[6];
  if (rawBaseUrl === void 0 || !rawBaseUrl.startsWith("model_providers.humanthread_local.base_url=")) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const tomlValue = rawBaseUrl.slice("model_providers.humanthread_local.base_url=".length);
  let parsedConfig;
  try {
    parsedConfig = parse(`value = ${tomlValue}`);
  } catch {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const baseUrl = parsedConfig.value;
  if (typeof baseUrl !== "string") {
    throw new Error("Codex local model provider arguments are invalid");
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Codex local model provider arguments are invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  return baseUrl;
}
function validateCodexLocalModelProvider(args) {
  const baseUrl = codexLocalModelProviderBaseUrl(args);
  const commandArgs = baseUrl !== null ? [args[0], ...args.slice(13)] : [...args];
  return { commandArgs, baseUrl };
}
function validateCodexReasoningEffort(args) {
  const PREFIX = "model_reasoning_effort=";
  const commandArgs = [];
  let selected = null;
  let index = 0;
  while (index < args.length) {
    if (args[index] === "--config" && args[index + 1]?.startsWith(PREFIX)) {
      if (selected !== null) {
        throw new Error("Codex reasoning effort arguments are invalid");
      }
      const value = args[index + 1].slice(PREFIX.length);
      const efforts = {
        '"low"': "low",
        '"medium"': "medium",
        '"high"': "high",
        '"xhigh"': "xhigh",
        '"max"': "max",
        '"ultra"': "ultra"
      };
      const effort = efforts[value];
      if (effort === void 0) {
        throw new Error("Codex reasoning effort arguments are invalid");
      }
      selected = effort;
      index += 2;
      continue;
    }
    commandArgs.push(args[index]);
    index += 1;
  }
  if (selected === null) {
    throw new Error("Codex reasoning effort arguments are invalid");
  }
  return commandArgs;
}
function validateCodexArgs(args) {
  const provider = validateCodexLocalModelProvider(args);
  const commandArgs = validateCodexReasoningEffort(provider.commandArgs);
  const validPrompt = (value) => value.length > 0 && value.length <= 131072 && !value.includes("\0");
  const validModel = (flag, value) => flag === "--model" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001F\u007F]/u.test(value);
  const validSessionId = (value) => value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_:.-]+$/u.test(value);
  const match = (pattern, checks, schemaIndex) => {
    if (commandArgs.length !== pattern.length) return null;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index];
      const value = commandArgs[index];
      const check = checks[index];
      if (expected !== null) {
        if (value !== expected) return null;
      } else if (check && !check(value)) {
        return null;
      }
    }
    return commandArgs[schemaIndex];
  };
  const patterns = [
    {
      pattern: ["exec", "--json", "--sandbox", "read-only", "--output-schema", null, null],
      checks: [null, null, null, null, null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 5
    },
    {
      pattern: ["exec", "--json", "--sandbox", "read-only", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 7
    },
    {
      pattern: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--output-schema", null, null],
      checks: [null, null, null, null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 4
    },
    {
      pattern: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 6
    },
    {
      pattern: ["exec", "--sandbox", "read-only", "resume", null, "--json", "--output-schema", null, null],
      checks: [null, null, null, null, validSessionId, null, null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 7
    },
    {
      pattern: ["exec", "--sandbox", "read-only", "resume", null, "--json", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, null, validSessionId, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 9
    },
    {
      pattern: ["exec", "--dangerously-bypass-approvals-and-sandbox", "resume", null, "--json", "--output-schema", null, null],
      checks: [null, null, null, validSessionId, null, null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 6
    },
    {
      pattern: ["exec", "--dangerously-bypass-approvals-and-sandbox", "resume", null, "--json", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, validSessionId, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1024, validPrompt],
      schemaIndex: 8
    }
  ];
  let resultSchema = null;
  for (const candidate of patterns) {
    resultSchema = match(candidate.pattern, candidate.checks, candidate.schemaIndex);
    if (resultSchema !== null) break;
  }
  if (resultSchema === null) {
    throw new Error("Codex arguments are invalid");
  }
  if (resultSchema.length > 1024 || resultSchema.includes("\0")) {
    throw new Error("Codex result Schema path is invalid");
  }
  if (provider.baseUrl !== null) {
    const modelCount = commandArgs.reduce(
      (count, value) => count + (value === "--model" ? 1 : 0),
      0
    );
    if (modelCount !== 1) {
      throw new Error("Codex local model provider requires an explicit model");
    }
  }
  return resultSchema;
}
function validateCodexRuntimeBinding(args, environmentOverrides, hasIndependentCredential) {
  const providerBaseUrl = codexLocalModelProviderBaseUrl(args);
  if (hasIndependentCredential && providerBaseUrl === null) {
    throw new Error("Independent Codex credentials require the selected local model provider");
  }
  if (providerBaseUrl !== null && environmentOverrides.OPENAI_BASE_URL !== providerBaseUrl) {
    throw new Error("Codex local model provider does not match the selected model site");
  }
}
function validateEnvironmentOverrides(overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== "OPENAI_BASE_URL" || value.length === 0 || value.length > 2048 || /[\u0000-\u001F\u007F]/u.test(value)) {
      throw new Error("Codex environment overrides are invalid");
    }
  }
}
function validateCodexCommandEnvironment(overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    const valid = key === "OPENAI_BASE_URL" ? value.length > 0 && value.length <= 2048 && !/[\u0000-\u001F\u007F]/u.test(value) : key === "OPENAI_API_KEY" ? value.length > 0 && value.length <= 4096 && !/[\u0000-\u001F\u007F]/u.test(value) : key === "CODEX_HOME" ? value.length > 0 && value.length <= 4096 && !/[\u0000-\u001F\u007F]/u.test(value) : false;
    if (!valid) {
      throw new Error("Codex environment overrides are invalid");
    }
  }
}
function buildCodexCommandWithOverrides(input) {
  validateCodexCommandEnvironment(input.environmentOverrides);
  const executablePath = buildAgentProbePath(input.executable, input.inheritedPath);
  const environment = buildInheritedCommandEnvironment({
    executablePath,
    environmentRefs: input.environmentRefs
  });
  Object.assign(environment, input.environmentOverrides);
  return {
    program: input.executable,
    args: [...input.args],
    cwd: input.cwd,
    env: environment
  };
}
function buildCodexCommand(input) {
  return buildCodexCommandWithOverrides({ ...input, environmentOverrides: {} });
}

// electron/commands.ts
var import_node_fs4 = require("node:fs");
var import_node_path5 = require("node:path");
var import_electron = require("electron");

// electron/lib/processes.ts
var import_node_child_process3 = require("node:child_process");
var import_node_readline = require("node:readline");

// electron/lib/workspace.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs3 = require("node:fs");
var import_node_path4 = require("node:path");
function isNotFound2(error) {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}
function splitAbsolutePath(value) {
  const root = (0, import_node_path4.parse)(value).root;
  const withoutRoot = value.slice(root.length);
  const parts = withoutRoot.split(process.platform === "win32" ? /[\\/]+/u : /\/+/u).filter((part) => part.length > 0 && part !== ".");
  return { root, parts };
}
function joinParts(root, parts) {
  if (parts.length === 0) return root;
  const suffix = parts.join(import_node_path4.sep);
  if (root.endsWith(import_node_path4.sep)) return `${root}${suffix}`;
  return `${root}${import_node_path4.sep}${suffix}`;
}
function validateWorkspaceDirectoryImpl(path) {
  if (!(0, import_node_path4.isAbsolute)(path)) {
    throw new Error("Project Workspace path must be absolute");
  }
  if (path.length > 4096 || /[\u0000-\u001F\u007F]/u.test(path)) {
    throw new Error("Project Workspace path is invalid");
  }
  let realpath;
  try {
    realpath = (0, import_node_fs3.realpathSync)(path);
  } catch (error) {
    throw new Error(`Failed to resolve project Workspace: ${error.message}`);
  }
  if (!(0, import_node_fs3.statSync)(realpath).isDirectory()) {
    throw new Error("Project Workspace must be a directory");
  }
  return { absolutePath: path, realpath };
}
function resolveWorkspacePathImpl(workspaceRoot, requestedPath) {
  if (!(0, import_node_path4.isAbsolute)(workspaceRoot) || !(0, import_node_path4.isAbsolute)(requestedPath)) {
    throw new Error("Workspace paths must be absolute");
  }
  let workspaceRealpath;
  try {
    workspaceRealpath = (0, import_node_fs3.realpathSync)(workspaceRoot);
  } catch (error) {
    throw new Error(`Failed to resolve project Workspace: ${error.message}`);
  }
  if (!(0, import_node_fs3.statSync)(workspaceRealpath).isDirectory()) {
    throw new Error("Project Workspace must be a directory");
  }
  const { root, parts } = splitAbsolutePath(requestedPath);
  let remaining = [...parts];
  const missingSuffix = [];
  for (; ; ) {
    const candidate = joinParts(root, remaining);
    try {
      (0, import_node_fs3.lstatSync)(candidate);
      break;
    } catch (error) {
      if (!isNotFound2(error)) {
        throw new Error(`Failed to inspect requested Workspace path: ${error.message}`);
      }
      const component = remaining[remaining.length - 1];
      if (component === void 0) {
        throw new Error("Requested Workspace path has no existing ancestor");
      }
      if (component === "..") {
        throw new Error("Parent traversal is forbidden in unresolved Workspace paths");
      }
      missingSuffix.push(component);
      remaining = remaining.slice(0, -1);
    }
  }
  const existingAncestor = joinParts(root, remaining);
  if (missingSuffix.length > 0 && !(0, import_node_fs3.statSync)(existingAncestor).isDirectory()) {
    throw new Error("Unresolved Workspace path must descend from a directory");
  }
  let targetRealpath;
  try {
    targetRealpath = (0, import_node_fs3.realpathSync)(existingAncestor);
  } catch (error) {
    throw new Error(`Failed to resolve requested Workspace path: ${error.message}`);
  }
  for (const component of missingSuffix.reverse()) {
    targetRealpath = (0, import_node_path4.join)(targetRealpath, component);
  }
  const relativePath = (0, import_node_path4.relative)(workspaceRealpath, targetRealpath);
  if (relativePath === ".." || relativePath.startsWith(`..${import_node_path4.sep}`) || (0, import_node_path4.isAbsolute)(relativePath)) {
    throw new Error("Resolved path is outside the project Workspace");
  }
  return { workspaceRealpath, targetRealpath, contained: true };
}
function workspaceRelativePath(workspaceRealpath, target) {
  const relativePath = (0, import_node_path4.relative)(workspaceRealpath, target);
  if (relativePath === ".." || relativePath.startsWith(`..${import_node_path4.sep}`) || (0, import_node_path4.isAbsolute)(relativePath)) {
    throw new Error("Workspace target is outside the project");
  }
  if (relativePath === "") return "";
  return relativePath.split(import_node_path4.sep).join("/");
}
function runGit(cwd, args) {
  const result = (0, import_node_child_process2.spawnSync)("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw new Error(`Failed to run Git: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "" };
}
function runGitChecked(cwd, args, failure) {
  const output = runGit(cwd, args);
  if (output.status !== 0) {
    throw new Error(failure);
  }
  return output.stdout;
}
function gitRefExists(cwd, reference) {
  const result = (0, import_node_child_process2.spawnSync)("git", ["-C", cwd, "show-ref", "--verify", "--quiet", reference], {
    stdio: "ignore"
  });
  if (result.error) throw new Error(`Failed to inspect Git ref: ${result.error.message}`);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Git ref inspection failed");
}
function inspectWorkspaceGitImpl(workspaceRoot, requestedPath) {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const workspaceRealpath = resolution.workspaceRealpath;
  let targetRealpath;
  try {
    targetRealpath = (0, import_node_fs3.realpathSync)(resolution.targetRealpath);
  } catch (error) {
    throw new Error(`Failed to resolve Git worktree: ${error.message}`);
  }
  if (!(0, import_node_fs3.statSync)(targetRealpath).isDirectory()) {
    throw new Error("Git worktree path must be a directory");
  }
  const identityOutput = runGit(targetRealpath, ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
  if (identityOutput.status !== 0) {
    throw new Error("Requested path is not a Git worktree");
  }
  const identityLines = identityOutput.stdout.split("\n").map((line) => line.trim());
  while (identityLines.length > 0 && identityLines[identityLines.length - 1] === "") identityLines.pop();
  if (identityLines.length !== 2 || identityLines.some((value) => value.length === 0)) {
    throw new Error("Git worktree identity is incomplete");
  }
  const gitTopLevelRaw = identityLines[0];
  const branch = identityLines[1];
  let gitTopLevel;
  try {
    gitTopLevel = (0, import_node_fs3.realpathSync)(gitTopLevelRaw);
  } catch (error) {
    throw new Error(`Failed to resolve Git worktree root: ${error.message}`);
  }
  if (gitTopLevel !== targetRealpath) {
    throw new Error("Git worktree root does not match the requested path");
  }
  const gitDirsOutput = runGit(targetRealpath, ["rev-parse", "--git-common-dir", "--git-dir"]);
  if (gitDirsOutput.status !== 0) {
    throw new Error("Git directory identity could not be read");
  }
  const gitDirLines = gitDirsOutput.stdout.split("\n").map((line) => line.trim());
  while (gitDirLines.length > 0 && gitDirLines[gitDirLines.length - 1] === "") gitDirLines.pop();
  if (gitDirLines.length !== 2 || gitDirLines.some((value) => value.length === 0)) {
    throw new Error("Git directory identity is incomplete");
  }
  const resolveGitDir = (value) => {
    const candidate = (0, import_node_path4.isAbsolute)(value) ? value : (0, import_node_path4.join)(targetRealpath, value);
    try {
      return (0, import_node_fs3.realpathSync)(candidate);
    } catch (error) {
      throw new Error(`Failed to resolve Git directory identity: ${error.message}`);
    }
  };
  const gitCommonDir = resolveGitDir(gitDirLines[0]);
  const gitDir = resolveGitDir(gitDirLines[1]);
  let expectedCommonDir;
  try {
    expectedCommonDir = (0, import_node_fs3.realpathSync)((0, import_node_path4.join)(workspaceRealpath, ".git"));
  } catch (error) {
    throw new Error(`Failed to resolve Workspace Git directory: ${error.message}`);
  }
  if (gitCommonDir !== expectedCommonDir) {
    throw new Error("Git worktree is not linked to the requested Workspace");
  }
  const headOutput = runGit(targetRealpath, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (headOutput.status !== 0) {
    throw new Error("Git HEAD could not be resolved");
  }
  const headCommit = headOutput.stdout.trim();
  if (branch === "HEAD" || branch.length > 191 || /[\u0000-\u001F\u007F]/u.test(branch) || !/^[0-9a-fA-F]+$/u.test(headCommit) || headCommit.length < 40 || headCommit.length > 64) {
    throw new Error("Git worktree branch or HEAD is invalid");
  }
  const statusOutput = runGit(targetRealpath, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (statusOutput.status !== 0) {
    throw new Error("Git worktree status could not be read");
  }
  return {
    workspaceRealpath,
    targetRealpath,
    branch,
    headCommit,
    clean: statusOutput.stdout.length === 0,
    isWorktree: targetRealpath !== workspaceRealpath && gitDir !== gitCommonDir
  };
}
function validTaskBranch(value) {
  return /^\d{4}-[A-Za-z0-9_-]+$/u.test(value) && value.length >= 6 && value.length <= 191;
}
function prepareTaskWorktreeImpl(workspaceRoot, taskBranch, baseBranch) {
  if (!validTaskBranch(taskBranch) || baseBranch.length === 0 || baseBranch.length > 191 || baseBranch.startsWith("-") || /[\u0000-\u001F\u007F]/u.test(baseBranch)) {
    throw new Error("Task worktree branch input is invalid");
  }
  const rootResolution = resolveWorkspacePathImpl(workspaceRoot, workspaceRoot);
  const workspaceRealpath = rootResolution.workspaceRealpath;
  inspectWorkspaceGitImpl(workspaceRealpath, workspaceRealpath);
  runGitChecked(workspaceRealpath, ["check-ref-format", "--branch", taskBranch], "Task branch is invalid");
  runGitChecked(workspaceRealpath, ["check-ref-format", "--branch", baseBranch], "Task base branch is invalid");
  runGitChecked(workspaceRealpath, ["check-ignore", "-q", "--", ".worktrees/"], "Task worktree directory must be ignored by Git");
  const requestedTarget = (0, import_node_path4.join)(workspaceRealpath, ".worktrees", taskBranch);
  const targetResolution = resolveWorkspacePathImpl(workspaceRealpath, requestedTarget);
  const targetPath = targetResolution.targetRealpath;
  let targetExists = true;
  try {
    (0, import_node_fs3.lstatSync)(targetPath);
  } catch (error) {
    if (!isNotFound2(error)) throw error;
    targetExists = false;
  }
  if (targetExists) {
    const identity2 = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
    if (identity2.branch !== taskBranch || !identity2.isWorktree) {
      throw new Error("Task worktree checkout does not match the assignment");
    }
    return identity2;
  }
  runGitChecked(workspaceRealpath, ["fetch", "--prune", "origin"], "Failed to fetch task worktree refs");
  const localRef = `refs/heads/${taskBranch}`;
  const remoteRef = `refs/remotes/origin/${taskBranch}`;
  const remoteTask = `origin/${taskBranch}`;
  const remoteBase = `origin/${baseBranch}`;
  runGitChecked(
    workspaceRealpath,
    ["rev-parse", "--verify", "--end-of-options", `${remoteBase}^{commit}`],
    "Task base branch did not resolve to a remote commit"
  );
  const worktreeOutput = runGitChecked(
    workspaceRealpath,
    ["worktree", "list", "--porcelain"],
    "Failed to inspect task worktree registrations"
  );
  let legacyPath = null;
  for (const entry of worktreeOutput.split("\n\n")) {
    const entryPath = entry.split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    const entryBranch = entry.split("\n").find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    if (entryBranch === taskBranch && entryPath !== void 0 && entryPath !== targetPath) {
      legacyPath = entryPath;
      break;
    }
  }
  if (legacyPath !== null) {
    runGitChecked(workspaceRealpath, ["worktree", "move", legacyPath, targetPath], "Failed to move the task worktree to its canonical path");
    const identity2 = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
    if (identity2.branch !== taskBranch || !identity2.isWorktree) {
      throw new Error("Prepared task worktree checkout does not match the assignment");
    }
    return identity2;
  }
  if (gitRefExists(workspaceRealpath, localRef)) {
    runGitChecked(workspaceRealpath, ["worktree", "add", targetPath, taskBranch], "Failed to attach the existing task branch worktree");
  } else if (gitRefExists(workspaceRealpath, remoteRef)) {
    runGitChecked(workspaceRealpath, ["worktree", "add", "-b", taskBranch, targetPath, remoteTask], "Failed to attach the remote task branch worktree");
  } else {
    runGitChecked(workspaceRealpath, ["worktree", "add", "-b", taskBranch, targetPath, remoteBase], "Failed to create the task branch worktree");
  }
  const identity = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
  if (identity.branch !== taskBranch || !identity.isWorktree) {
    throw new Error("Prepared task worktree identity is invalid");
  }
  return identity;
}
function readWorkspaceFileImpl(workspaceRoot, requestedPath, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 1048576) {
    throw new Error("Workspace read limit must be between 1 byte and 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  let metadata;
  try {
    metadata = (0, import_node_fs3.statSync)(resolution.targetRealpath);
  } catch (error) {
    if (isNotFound2(error)) return null;
    throw new Error(`Failed to inspect Workspace file: ${error.message}`);
  }
  if (!metadata.isFile()) {
    throw new Error("Requested Workspace path is not a file");
  }
  if (metadata.size > maxBytes) {
    throw new Error("Workspace file exceeds the requested read limit");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode((0, import_node_fs3.readFileSync)(resolution.targetRealpath));
  } catch (error) {
    throw new Error(`Failed to read Workspace file: ${error.message}`);
  }
}
async function runWorkspaceCheckImpl(input) {
  const { command, timeoutMs } = input;
  if (command.length === 0 || command.length > 2048 || /[\u0000-\u001F\u007F]/u.test(command)) {
    throw new Error("Stage check command is invalid");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1e3 || timeoutMs > 6e5) {
    throw new Error("Stage check timeout must be between 1 second and 10 minutes");
  }
  const resolution = resolveWorkspacePathImpl(input.workspaceRoot, input.workspaceRoot);
  const spec = buildManagedCommand(resolution.workspaceRealpath, command);
  const child = (0, import_node_child_process2.spawn)(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true
  });
  const outcome = await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (child.pid !== void 0) killProcessTree(child.pid);
      try {
        child.kill("SIGKILL");
      } catch {
      }
      resolvePromise({ kind: "timeout" });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({ kind: "error", message: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ kind: "exit", code });
    });
  });
  if (outcome.kind === "error") {
    throw new Error(`Failed to start Stage check: ${outcome.message}`);
  }
  if (outcome.kind === "timeout") {
    return { passed: false, summary: "Stage check timed out" };
  }
  return {
    passed: outcome.code === 0,
    summary: outcome.code === 0 ? "Stage check passed" : `Stage check failed with exit code ${outcome.code === null ? "unknown" : String(outcome.code)}`
  };
}
function temporarySiblingPath(target) {
  const extension = (0, import_node_path4.extname)(target);
  const base = extension.length > 0 ? target.slice(0, -extension.length) : target;
  return `${base}.${process.pid}.tmp`;
}
function createExclusiveFile(path, content, failure) {
  let descriptor;
  try {
    descriptor = (0, import_node_fs3.openSync)(path, "wx");
  } catch (error) {
    throw new Error(`${failure}: ${error.message}`);
  }
  try {
    (0, import_node_fs3.writeSync)(descriptor, content);
    (0, import_node_fs3.fsyncSync)(descriptor);
  } catch (error) {
    (0, import_node_fs3.closeSync)(descriptor);
    (0, import_node_fs3.rmSync)(path, { force: true });
    throw new Error(`${failure}: ${error.message}`);
  }
  (0, import_node_fs3.closeSync)(descriptor);
}
function writeWorkspaceFileImpl(workspaceRoot, requestedPath, content) {
  if (Buffer.byteLength(content, "utf8") > 1048576) {
    throw new Error("Workspace file exceeds 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const target = resolution.targetRealpath;
  const parent = (0, import_node_path4.dirname)(target);
  if (parent === target) throw new Error("Workspace file has no parent");
  try {
    (0, import_node_fs3.mkdirSync)(parent, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace file directory: ${error.message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, target);
  const verifiedTarget = verified.targetRealpath;
  const temporary = temporarySiblingPath(verifiedTarget);
  createExclusiveFile(temporary, content, "Failed to create temporary Workspace file");
  try {
    (0, import_node_fs3.renameSync)(temporary, verifiedTarget);
  } catch (error) {
    (0, import_node_fs3.rmSync)(temporary, { force: true });
    throw new Error(`Failed to publish Workspace file: ${error.message}`);
  }
  return verifiedTarget;
}
function createWorkspaceDirectoryImpl(workspaceRoot, requestedPath) {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  try {
    (0, import_node_fs3.mkdirSync)(resolution.targetRealpath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace directory: ${error.message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, resolution.targetRealpath);
  return verified.targetRealpath;
}
function createWorkspaceFileImpl(workspaceRoot, requestedPath, content) {
  if (Buffer.byteLength(content, "utf8") > 1048576) {
    throw new Error("Workspace file exceeds 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const target = resolution.targetRealpath;
  const parent = (0, import_node_path4.dirname)(target);
  if (parent === target) throw new Error("Workspace file has no parent");
  try {
    (0, import_node_fs3.mkdirSync)(parent, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace file directory: ${error.message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, target);
  createExclusiveFile(verified.targetRealpath, content, "Failed to create exclusive Workspace file");
  return verified.targetRealpath;
}
function withoutManagedBlock(value) {
  const START = "<!-- HUMANTHREAD:SKILLS:START -->";
  const END = "<!-- HUMANTHREAD:SKILLS:END -->";
  const start = value.indexOf(START);
  if (start < 0) return null;
  if (value.slice(start + START.length).includes(START)) return null;
  const relativeEnd = value.slice(start + START.length).indexOf(END);
  if (relativeEnd < 0) return null;
  const end = start + START.length + relativeEnd;
  if (value.slice(end + END.length).includes(END)) return null;
  let after = end + END.length;
  if (value.slice(after).startsWith("\r\n")) after += 2;
  else if (value.slice(after).startsWith("\n")) after += 1;
  return `${value.slice(0, start)}${value.slice(after)}`;
}
function replaceWorkspaceStructureFileImpl(workspaceRoot, requestedPath, content) {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const relativePath = workspaceRelativePath(resolution.workspaceRealpath, resolution.targetRealpath);
  const parts = relativePath.split("/");
  const generatedProjection = relativePath === ".humanthread/structure/manifest.json" || relativePath === ".humanthread/structure/lock.json" || relativePath === ".humanthread/CONFIGURATION.md" || parts.length === 4 && parts[0] === ".humanthread" && parts[1] === "loops" && parts[3] === "loop.yaml";
  if (!generatedProjection && relativePath !== "CLAUDE.md") {
    throw new Error("Atomic replacement is limited to HumanThread structure files");
  }
  if (relativePath === "CLAUDE.md") {
    const nextOutside = withoutManagedBlock(content);
    if (nextOutside === null) {
      throw new Error("CLAUDE.md replacement requires one HumanThread managed block");
    }
    let current = "";
    try {
      current = (0, import_node_fs3.readFileSync)(resolution.targetRealpath, "utf8");
    } catch (error) {
      if (!isNotFound2(error)) {
        throw new Error(`Failed to read CLAUDE.md: ${error.message}`);
      }
    }
    const currentOutside = withoutManagedBlock(current) ?? current;
    if (nextOutside !== currentOutside) {
      throw new Error("CLAUDE.md content outside the HumanThread managed block must remain unchanged");
    }
  }
  return writeWorkspaceFileImpl(workspaceRoot, requestedPath, content);
}
function listWorkspaceTreeImpl(workspaceRoot, requestedPath, maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0 || maxEntries > 1e4) {
    throw new Error("Workspace tree limit must be between 1 and 10000 entries");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const workspaceRealpath = resolution.workspaceRealpath;
  const target = resolution.targetRealpath;
  let metadata;
  try {
    metadata = (0, import_node_fs3.lstatSync)(target);
  } catch (error) {
    if (isNotFound2(error)) return [];
    throw new Error(`Failed to inspect Workspace tree: ${error.message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  const files = [];
  const directories = metadata.isDirectory() ? [target] : [];
  if (metadata.isFile()) {
    files.push(workspaceRelativePath(workspaceRealpath, target));
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    let entries;
    try {
      entries = (0, import_node_fs3.readdirSync)(directory);
    } catch (error) {
      throw new Error(`Failed to read Workspace tree: ${error.message}`);
    }
    for (const entry of entries) {
      const entryPath = (0, import_node_path4.join)(directory, entry);
      let entryMetadata;
      try {
        entryMetadata = (0, import_node_fs3.lstatSync)(entryPath);
      } catch (error) {
        throw new Error(`Failed to inspect Workspace tree entry: ${error.message}`);
      }
      if (entryMetadata.isSymbolicLink()) {
        throw new Error("Symlinks are forbidden in local Loop configuration");
      }
      if (entryMetadata.isDirectory()) {
        directories.push(entryPath);
      } else if (entryMetadata.isFile()) {
        files.push(workspaceRelativePath(workspaceRealpath, entryPath));
        if (files.length > maxEntries) {
          throw new Error("Workspace tree exceeds the requested entry limit");
        }
      }
    }
  }
  files.sort();
  return files;
}
function validSyncTransactionId(value) {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}
function renameWorkspaceLoopPathImpl(workspaceRoot, fromPath, toPath) {
  const source = resolveWorkspacePathImpl(workspaceRoot, fromPath);
  const target = resolveWorkspacePathImpl(workspaceRoot, toPath);
  const workspace = source.workspaceRealpath;
  const fromRelative = workspaceRelativePath(workspace, source.targetRealpath);
  const toRelative = workspaceRelativePath(workspace, target.targetRealpath);
  const fromParts = fromRelative.split("/");
  const toParts = toRelative.split("/");
  const nodesIndex = fromParts.indexOf("nodes");
  if (fromParts.length < 5 || fromParts[0] !== ".humanthread" || fromParts[1] !== "loops" || nodesIndex < 0) {
    throw new Error("Only a v1 node directory may be migrated");
  }
  if (toParts.length < 7 || toParts[0] !== ".humanthread" || toParts[1] !== "runtime" || toParts[2] !== "sync" || !validSyncTransactionId(toParts[3]) || toParts[4] !== "backup" || toParts.slice(5).join("/") !== fromParts.slice(1).join("/")) {
    throw new Error("Migration backup must match the v1 node path");
  }
  const sourcePath = source.targetRealpath;
  if ((0, import_node_fs3.lstatSync)(sourcePath).isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  const targetPath = target.targetRealpath;
  try {
    (0, import_node_fs3.lstatSync)(targetPath);
    throw new Error("Migration backup already exists");
  } catch (error) {
    if (!isNotFound2(error)) throw error;
  }
  try {
    (0, import_node_fs3.mkdirSync)((0, import_node_path4.dirname)(targetPath), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create migration backup directory: ${error.message}`);
  }
  try {
    (0, import_node_fs3.renameSync)(sourcePath, targetPath);
  } catch (error) {
    throw new Error(`Failed to move v1 node to migration backup: ${error.message}`);
  }
  return targetPath;
}
function removeWorkspaceSyncTransactionImpl(workspaceRoot, requestedPath) {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const relativePath = workspaceRelativePath(resolution.workspaceRealpath, resolution.targetRealpath);
  const parts = relativePath.split("/");
  if (parts.length !== 4 || parts[0] !== ".humanthread" || parts[1] !== "runtime" || parts[2] !== "sync" || !validSyncTransactionId(parts[3])) {
    throw new Error("Only a specific Loop sync transaction may be removed");
  }
  const target = resolution.targetRealpath;
  let metadata;
  try {
    metadata = (0, import_node_fs3.lstatSync)(target);
  } catch (error) {
    if (isNotFound2(error)) return;
    throw new Error(`Failed to inspect Loop sync transaction: ${error.message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  try {
    (0, import_node_fs3.rmSync)(target, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Failed to remove Loop sync transaction: ${error.message}`);
  }
}

// electron/lib/processes.ts
var ManagedCommandRegistry = class {
  commands = /* @__PURE__ */ new Map();
  insertProject(processId, externalSession) {
    this.commands.set(processId, { kind: "project", externalSession });
  }
  insertCodex(processId) {
    this.commands.set(processId, { kind: "codex" });
  }
  containsCodex(processId) {
    return this.commands.get(processId)?.kind === "codex";
  }
  remove(processId) {
    this.commands.delete(processId);
  }
  quitState() {
    return {
      managedRunning: this.commands.size > 0,
      externalSession: [...this.commands.values()].some(
        (entry) => entry.kind === "project" && entry.externalSession
      )
    };
  }
  processIds() {
    return [...this.commands.keys()];
  }
  interruptAll() {
    for (const processId of this.processIds()) {
      if (!buildInterruptCommandSpec(desktopPlatformName(), processId)) {
        throw new Error("Managed command interruption is unavailable on this platform");
      }
      interruptProcess(processId);
    }
  }
};
function validateProcessKey(value) {
  if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:.-]+$/u.test(value)) {
    throw new Error("Codex process key is invalid");
  }
}
function startCodexProcess(input) {
  validateProcessKey(input.processKey);
  validateEnvironmentRefs(input.environmentRefs);
  let environmentRefs = [...input.environmentRefs];
  const environmentOverrides = { ...input.environmentOverrides ?? {} };
  validateEnvironmentOverrides(environmentOverrides);
  const resultSchemaPath = validateCodexArgs(input.args);
  validateCodexRuntimeBinding(input.args, environmentOverrides, input.credentialContext !== void 0);
  if (input.credentialContext) {
    environmentRefs = removeIndependentCredentialEnvironmentRefs(environmentRefs);
    const context = input.credentialContext;
    const apiKey = readAgentCredential(context.deploymentOrigin, context.userId, context.credentialRef);
    const codexHome = prepareIsolatedCodexHome(context.deploymentOrigin, context.userId);
    environmentOverrides.OPENAI_API_KEY = apiKey;
    environmentOverrides.CODEX_HOME = codexHome;
  }
  const resolution = resolveWorkspacePathImpl(input.cwd, input.cwd);
  resolveWorkspacePathImpl(resolution.workspaceRealpath, resultSchemaPath);
  const executable = resolveCodexExecutable(input.executable);
  const spec = Object.keys(environmentOverrides).length === 0 ? buildCodexCommand({
    executable,
    cwd: resolution.targetRealpath,
    args: input.args,
    inheritedPath: process.env.PATH,
    environmentRefs
  }) : buildCodexCommandWithOverrides({
    executable,
    cwd: resolution.targetRealpath,
    args: input.args,
    inheritedPath: process.env.PATH,
    environmentRefs,
    environmentOverrides
  });
  const child = (0, import_node_child_process3.spawn)(spec.program, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  const processId = child.pid;
  if (processId === void 0) {
    throw new Error("Failed to start Codex: process ID is unavailable");
  }
  input.registry.insertCodex(processId);
  const streams = [];
  if (child.stdout) streams.push({ stream: "stdout", source: child.stdout });
  if (child.stderr) streams.push({ stream: "stderr", source: child.stderr });
  const readers = streams.map(({ stream, source }) => {
    const reader = (0, import_node_readline.createInterface)({ input: source });
    reader.on("line", (line) => {
      const payload = {
        processKey: input.processKey,
        processId,
        stream,
        chunk: `${line}
`
      };
      input.host.send("codex_process_output", payload);
    });
    return reader;
  });
  child.once("error", () => {
    for (const reader of readers) reader.close();
    input.registry.remove(processId);
    const payload = {
      processKey: input.processKey,
      processId,
      code: null,
      signal: "wait_failed"
    };
    input.host.send("codex_process_exit", payload);
  });
  child.once("exit", (code, signal) => {
    for (const reader of readers) reader.close();
    input.registry.remove(processId);
    const payload = {
      processKey: input.processKey,
      processId,
      code,
      signal: code === null ? signal ?? "signal" : null
    };
    input.host.send("codex_process_exit", payload);
  });
  return processId;
}
function cancelCodexProcess(registry, processId) {
  if (!registry.containsCodex(processId)) return;
  const spec = buildInterruptCommandSpec(desktopPlatformName(), processId);
  if (!spec) {
    throw new Error("Codex cancellation is unavailable on this platform");
  }
  const child = (0, import_node_child_process3.spawn)(spec.program, spec.args, { stdio: "ignore", windowsHide: true });
  if (child.pid === void 0) {
    throw new Error("Codex could not be cancelled");
  }
}
function launchProjectCommand(input) {
  const spec = buildManagedCommand(input.cwd, input.command);
  const child = (0, import_node_child_process3.spawn)(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: ["ignore", "ignore", "ignore"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  const processId = child.pid;
  if (processId === void 0) {
    throw new Error("Failed to launch project command: process ID is unavailable");
  }
  const externalSession = input.sessionName.trim().length > 0 && input.sessionType.trim() === "tmux";
  input.registry.insertProject(processId, externalSession);
  child.once("error", (error) => {
    input.registry.remove(processId);
    const payload = {
      taskId: input.taskId,
      projectId: input.projectId,
      workflowInstanceId: input.workflowInstanceId,
      cwd: input.cwd,
      command: input.command,
      processId,
      shell: spec.shell,
      status: "interrupted",
      exitCode: null,
      signal: null,
      error: `Failed to wait for command exit: ${error.message}`,
      sessionName: input.sessionName,
      sessionType: input.sessionType
    };
    input.host.send("command_exited", payload);
  });
  child.once("exit", (code) => {
    input.registry.remove(processId);
    const payload = {
      taskId: input.taskId,
      projectId: input.projectId,
      workflowInstanceId: input.workflowInstanceId,
      cwd: input.cwd,
      command: input.command,
      processId,
      shell: spec.shell,
      status: code === 0 ? "completed" : "interrupted",
      exitCode: code,
      signal: null,
      sessionName: input.sessionName,
      sessionType: input.sessionType
    };
    input.host.send("command_exited", payload);
  });
  return {
    shell: spec.shell,
    processId,
    sessionName: input.sessionName,
    sessionType: input.sessionType
  };
}
function restoreToolSession(input) {
  const spec = buildRestoreSessionCommand(input.cwd, input.sessionName, input.sessionType);
  const child = (0, import_node_child_process3.spawn)(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: ["ignore", "ignore", "ignore"],
    detached: process.platform !== "win32",
    windowsHide: true
  });
  if (child.pid === void 0) {
    throw new Error("Failed to restore tool session: process ID is unavailable");
  }
  return {
    shell: spec.shell,
    processId: child.pid,
    sessionName: input.sessionName,
    sessionType: input.sessionType
  };
}
function openTerminalAtPath(path) {
  const spec = buildTerminalLauncherCommand(path);
  const child = (0, import_node_child_process3.spawn)(spec.program, spec.args, {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true
  });
  if (child.pid === void 0) {
    throw new Error("Failed to open terminal at project path: process ID is unavailable");
  }
  return {
    shell: spec.shell,
    processId: child.pid,
    sessionName: null,
    sessionType: null
  };
}

// electron/commands.ts
var TRAY_ITEM_IDS = ["status", "current-task", "toggle-window", "self-check", "quit"];
var NOTIFICATION_KINDS = [
  "assignment",
  "approval",
  "blocker",
  "reminder",
  "command_completed",
  "command_failed"
];
function readArg(args, ...keys) {
  for (const key of keys) {
    const value = args[key];
    if (value !== void 0 && value !== null) return value;
  }
  return void 0;
}
function requireString(args, ...keys) {
  const value = readArg(args, ...keys);
  if (typeof value !== "string") {
    throw new Error(`Native command argument is invalid: ${keys[0]}`);
  }
  return value;
}
function validateTrayItemIds(ids) {
  if (ids.length !== TRAY_ITEM_IDS.length || ids.some((id, index) => id !== TRAY_ITEM_IDS[index])) {
    throw new Error("Tray menu items are invalid");
  }
}
function validateDesktopTaskRoute(route) {
  if (!route.startsWith("/tasks/")) {
    throw new Error("Desktop Task route is invalid");
  }
  const taskId = route.slice("/tasks/".length);
  if (taskId.length === 0 || taskId.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(taskId)) {
    throw new Error("Desktop Task route is invalid");
  }
}
function validateDesktopNotificationRoute(id, route) {
  try {
    validateDesktopTaskRoute(route);
    return;
  } catch {
  }
  if (!id.startsWith("loop-notification:") || !route.startsWith("/notifications?")) {
    throw new Error("Native notification route is invalid");
  }
  let parsed;
  try {
    parsed = new URL(`https://desktop.humanthread.local${route}`);
  } catch {
    throw new Error("Native notification route is invalid");
  }
  if (parsed.pathname !== "/notifications" || parsed.hash.length > 0) {
    throw new Error("Native notification route is invalid");
  }
  const slots = {};
  for (const [key, value] of parsed.searchParams) {
    if (!["item", "read", "kind"].includes(key) || slots[key] !== void 0) {
      throw new Error("Native notification route is invalid");
    }
    slots[key] = value;
  }
  if (slots.item !== id || slots.read !== "all" || slots.kind !== "all") {
    throw new Error("Native notification route is invalid");
  }
}
function validateNativeNotificationSeverity(kind, title, body) {
  if (!NOTIFICATION_KINDS.includes(kind)) {
    throw new Error("Native notification kind is invalid");
  }
  const titleLength = [...title.trim()].length;
  const bodyLength = [...body.trim()].length;
  if (titleLength === 0 || titleLength > 80 || bodyLength === 0 || bodyLength > 240 || /[\u0000-\u001F\u007F]/u.test(title) || /[\u0000-\u001F\u007F]/u.test(body)) {
    throw new Error("Native notification copy is invalid");
  }
}
function validateNativeNotificationTarget(id, route) {
  const normalized = id.trim();
  if (normalized.length === 0 || [...normalized].length > 128 || !/^[A-Za-z0-9_:.-]+$/u.test(normalized)) {
    throw new Error("Native notification id is invalid");
  }
  if (route !== void 0) {
    validateDesktopNotificationRoute(normalized, route);
  }
}
function resolveQuitState(context) {
  const { managedRunning, externalSession } = context.managed.quitState();
  return {
    managedRunning: managedRunning || context.codexServers.hasRunning() || context.codexTui.list().some((session) => session.status === "running" || session.status === "starting"),
    externalSession
  };
}
function validateQuitChoiceForState(choice, state) {
  if (!["quit", "keep_session_and_quit", "interrupt_and_quit"].includes(choice)) {
    throw new Error("Desktop quit choice is invalid");
  }
  const allowed = choice === "quit" ? !state.managedRunning && !state.externalSession : choice === "keep_session_and_quit" ? state.externalSession : state.managedRunning;
  if (!allowed) {
    throw new Error("Desktop quit choice is unavailable for the current process state");
  }
}
function isAllowedWebHandoffUrl(value, deploymentUrl) {
  let target;
  let deployment;
  try {
    target = new URL(value.trim());
    deployment = new URL(deploymentUrl.trim());
  } catch {
    return false;
  }
  if (target.origin !== deployment.origin || target.pathname !== "/api/desktop/web-handoff/consume" || target.username.length > 0 || target.password.length > 0 || target.hash.length > 0) {
    return false;
  }
  const code = target.searchParams.get("code")?.trim() ?? "";
  return target.searchParams.size === 1 && code.length > 0 && code.length <= 256;
}
function requireWindowId(context) {
  const windowId = context?.windowId;
  if (typeof windowId !== "number" || !Number.isSafeInteger(windowId) || windowId <= 0) {
    throw new Error("Desktop window id is invalid");
  }
  return windowId;
}
function validateTuiBase64(value) {
  if (value.length === 0 || value.length > Math.ceil(256 * 1024 * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("Codex TUI input is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > 256 * 1024) {
    throw new Error("Codex TUI input is invalid");
  }
}
function tuiSessionArgs(args) {
  const optional = (key) => {
    const value = readArg(args, key);
    if (value === void 0 || value === null) return null;
    if (typeof value !== "string") throw new Error(`Native command argument is invalid: ${key}`);
    return value;
  };
  return {
    sessionId: requireString(args, "sessionId", "session_id"),
    runId: requireString(args, "runId", "run_id"),
    taskId: optional("taskId"),
    projectId: optional("projectId"),
    nodeKey: optional("nodeKey"),
    processKey: requireString(args, "processKey", "process_key"),
    threadId: requireString(args, "threadId", "thread_id"),
    cwd: requireString(args, "cwd"),
    model: optional("model")
  };
}
function createCommandHandlers(context) {
  const handlers = {
    prepare_direct_agent_workspace: (args) => {
      const deviceId = requireString(args, "deviceId", "device_id");
      const sessionId = requireString(args, "sessionId", "session_id");
      if (!/^[a-f0-9]{32}$/u.test(sessionId) || !/^[A-Za-z0-9_-]{1,96}$/u.test(deviceId)) {
        throw new Error("Direct Agent Workspace identity is invalid");
      }
      const root = (0, import_node_path5.join)(import_electron.app.getPath("userData"), "direct-agent-sessions", deviceId, sessionId);
      (0, import_node_fs4.mkdirSync)(root, { recursive: true, mode: 448 });
      return root;
    },
    validate_workspace_directory: (args) => validateWorkspaceDirectoryImpl(requireString(args, "path")),
    resolve_workspace_path: (args) => resolveWorkspacePathImpl(requireString(args, "workspaceRoot", "workspace_root"), requireString(args, "requestedPath", "requested_path")),
    inspect_workspace_git: (args) => inspectWorkspaceGitImpl(requireString(args, "workspaceRoot", "workspace_root"), requireString(args, "requestedPath", "requested_path")),
    prepare_task_worktree: (args) => prepareTaskWorktreeImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "taskBranch", "task_branch"),
      requireString(args, "baseBranch", "base_branch")
    ),
    read_workspace_file: (args) => readWorkspaceFileImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path"),
      readArg(args, "maxBytes", "max_bytes") ?? 0
    ),
    run_workspace_check: (args) => runWorkspaceCheckImpl({
      workspaceRoot: requireString(args, "workspaceRoot", "workspace_root"),
      command: requireString(args, "command"),
      timeoutMs: readArg(args, "timeoutMs", "timeout_ms") ?? 0
    }),
    write_workspace_file: (args) => writeWorkspaceFileImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path"),
      requireString(args, "content")
    ),
    list_workspace_tree: (args) => listWorkspaceTreeImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path"),
      readArg(args, "maxEntries", "max_entries") ?? 0
    ),
    create_workspace_directory: (args) => createWorkspaceDirectoryImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path")
    ),
    create_workspace_file: (args) => createWorkspaceFileImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path"),
      requireString(args, "content")
    ),
    replace_workspace_structure_file: (args) => replaceWorkspaceStructureFileImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path"),
      requireString(args, "content")
    ),
    rename_workspace_loop_path: (args) => renameWorkspaceLoopPathImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "fromPath", "from_path"),
      requireString(args, "toPath", "to_path")
    ),
    remove_workspace_sync_transaction: (args) => removeWorkspaceSyncTransactionImpl(
      requireString(args, "workspaceRoot", "workspace_root"),
      requireString(args, "requestedPath", "requested_path")
    ),
    probe_agent_runtime: (args) => probeAgentRuntimeImpl({
      provider: requireString(args, "provider"),
      command: requireString(args, "command"),
      environmentRefs: readArg(args, "environmentRefs", "environment_refs") ?? [],
      ...typeof readArg(args, "credential") === "string" ? { credential: readArg(args, "credential") } : {},
      ...readArg(args, "credentialContext", "credential_context") !== void 0 ? { credentialContext: readArg(args, "credentialContext", "credential_context") } : {}
    }),
    install_agent_runtime: (args) => installAgentRuntimeImpl({
      provider: requireString(args, "provider"),
      environmentRefs: readArg(args, "environmentRefs", "environment_refs") ?? []
    }),
    start_codex_process: (args) => startCodexProcess({
      host: context.host,
      registry: context.managed,
      processKey: requireString(args, "processKey", "process_key"),
      cwd: requireString(args, "cwd"),
      executable: requireString(args, "executable"),
      args: readArg(args, "args") ?? [],
      environmentRefs: readArg(args, "environmentRefs", "environment_refs") ?? [],
      ...readArg(args, "environmentOverrides", "environment_overrides") !== void 0 ? { environmentOverrides: readArg(args, "environmentOverrides", "environment_overrides") } : {},
      ...readArg(args, "credentialContext", "credential_context") !== void 0 ? { credentialContext: readArg(args, "credentialContext", "credential_context") } : {}
    }),
    cancel_codex_process: (args) => {
      cancelCodexProcess(context.managed, readArg(args, "processId", "process_id") ?? 0);
      return null;
    },
    start_codex_app_server: (args) => {
      const input = readArg(args, "input");
      return context.codexServers.start(input);
    },
    request_codex_app_server: (args) => context.codexServers.request(
      requireString(args, "processKey", "process_key"),
      requireString(args, "method"),
      readArg(args, "params") ?? null
    ),
    notify_codex_app_server: (args) => context.codexServers.notify(
      requireString(args, "processKey", "process_key"),
      requireString(args, "method"),
      readArg(args, "params") ?? null
    ),
    respond_codex_app_server: (args) => context.codexServers.respond(
      requireString(args, "processKey", "process_key"),
      readArg(args, "requestId", "request_id"),
      readArg(args, "result"),
      readArg(args, "error")
    ),
    cancel_codex_app_server: (args) => context.codexServers.cancel(
      requireString(args, "processKey", "process_key"),
      requireString(args, "threadId", "thread_id"),
      typeof readArg(args, "turnId", "turn_id") === "string" ? readArg(args, "turnId", "turn_id") : void 0
    ),
    stop_codex_app_server: (args) => {
      context.codexServers.stop(requireString(args, "processKey", "process_key"));
      return null;
    },
    list_codex_app_servers: () => context.codexServers.states(),
    register_codex_tui_session: (args) => {
      context.codexTui.register(tuiSessionArgs(args));
      return null;
    },
    start_codex_tui_session: (args) => context.codexTui.start(tuiSessionArgs(args)),
    unregister_codex_tui_session: (args) => {
      context.codexTui.unregister(requireString(args, "sessionId", "session_id"));
      return null;
    },
    freeze_codex_tui_session: async (args) => {
      await context.codexTui.freeze(requireString(args, "sessionId", "session_id"));
      return null;
    },
    list_codex_tui_sessions: () => context.codexTui.list(),
    spawn_codex_tui: (args, handlerContext) => context.codexTui.spawn({
      ...tuiSessionArgs(args),
      windowId: requireWindowId(handlerContext)
    }),
    attach_codex_tui: (args, handlerContext) => context.codexTui.attach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext)
    ),
    reattach_codex_tui: (args, handlerContext) => context.codexTui.reattach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext)
    ),
    detach_codex_tui: (args, handlerContext) => context.codexTui.detach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext)
    ),
    write_codex_tui: async (args, handlerContext) => {
      const deltaBase64 = requireString(args, "deltaBase64", "delta_base64");
      validateTuiBase64(deltaBase64);
      await context.codexTui.write(
        requireString(args, "sessionId", "session_id"),
        requireWindowId(handlerContext),
        deltaBase64
      );
      return null;
    },
    resize_codex_tui: async (args, handlerContext) => {
      const rows = readArg(args, "rows") ?? 0;
      const cols = readArg(args, "cols") ?? 0;
      if (!Number.isSafeInteger(rows) || rows < 1 || rows > 500 || !Number.isSafeInteger(cols) || cols < 1 || cols > 1e3) {
        throw new Error("Codex TUI terminal size is invalid");
      }
      await context.codexTui.resize(
        requireString(args, "sessionId", "session_id"),
        requireWindowId(handlerContext),
        rows,
        cols
      );
      return null;
    },
    acquire_codex_tui_control: (args, handlerContext) => context.codexTui.acquire(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext)
    ),
    release_codex_tui_control: (args, handlerContext) => context.codexTui.release(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext)
    ),
    close_codex_tui: async (args) => {
      await context.codexTui.close(requireString(args, "sessionId", "session_id"));
      return null;
    },
    open_live_session: async (args) => {
      await context.liveSessions.open({
        sessionId: requireString(args, "sessionId", "session_id"),
        relayUrl: requireString(args, "relayUrl", "relay_url"),
        authorization: requireString(args, "authorization")
      });
      return null;
    },
    close_live_session: async (args) => {
      await context.liveSessions.close(requireString(args, "sessionId", "session_id"));
      return null;
    },
    live_session_state: (args) => context.liveSessions.state(requireString(args, "sessionId", "session_id")),
    get_agent_credential_status: (args) => getAgentCredentialStatus({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      credentialRef: requireString(args, "credentialRef", "credential_ref")
    }),
    set_agent_credential: (args) => setAgentCredential({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      credentialRef: requireString(args, "credentialRef", "credential_ref"),
      kind: requireString(args, "kind"),
      apiKey: requireString(args, "apiKey", "api_key")
    }),
    delete_agent_credential: (args) => deleteAgentCredential({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      credentialRef: requireString(args, "credentialRef", "credential_ref")
    }),
    list_model_sites: (args) => listModelSites({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id")
    }),
    save_model_site: (args) => saveModelSite({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      site: readArg(args, "site"),
      accountDefault: readArg(args, "accountDefault", "account_default") ?? null
    }),
    save_model_defaults: (args) => saveModelDefaults({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      accountDefault: readArg(args, "accountDefault", "account_default") ?? null
    }),
    delete_model_site: (args) => deleteModelSite({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      siteId: requireString(args, "siteId", "site_id")
    }),
    get_model_catalog: (args) => getModelCatalog({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id")
    }),
    save_model_catalog: (args) => saveModelCatalog({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      catalog: readArg(args, "catalog")
    }),
    get_loop_model_routing: (args) => getLoopModelRouting({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id")
    }),
    save_loop_model_routing: (args) => saveLoopModelRouting({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      routing: readArg(args, "routing")
    }),
    test_and_refresh_model_site: (args) => testAndRefreshModelSite({
      deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
      userId: requireString(args, "userId", "user_id"),
      site: readArg(args, "site"),
      ...readArg(args, "catalog") !== void 0 && readArg(args, "catalog") !== null ? { catalog: readArg(args, "catalog") } : {},
      ...typeof readArg(args, "credential") === "string" ? { credential: readArg(args, "credential") } : {},
      fetch: context.host.modelFetch
    }),
    set_tray_menu: (args) => {
      const state = readArg(args, "state");
      if (!state || !Array.isArray(state.items)) {
        throw new Error("Tray menu items are invalid");
      }
      validateTrayItemIds(state.items.map((item) => item.id));
      for (const item of state.items) {
        const label = item.label.trim();
        if (label.length === 0 || [...label].length > 96 || /[\u0000-\u001F\u007F]/u.test(label)) {
          throw new Error("Tray menu label is invalid");
        }
        if (item.id === "current-task") {
          if (item.route !== void 0) {
            try {
              validateDesktopTaskRoute(item.route);
            } catch {
              throw new Error("Tray current Task route is invalid");
            }
          }
        } else if (item.route !== void 0) {
          throw new Error("Tray menu route is invalid");
        }
      }
      context.host.updateTray(state);
      return null;
    },
    send_native_notification: async (args) => {
      const kind = requireString(args, "kind");
      const title = requireString(args, "title");
      const body = requireString(args, "body");
      const id = requireString(args, "id");
      const route = typeof readArg(args, "route") === "string" ? readArg(args, "route") : void 0;
      validateNativeNotificationSeverity(kind, title, body);
      validateNativeNotificationTarget(id, route);
      await context.host.showNotification({ id, kind, title, body, ...route === void 0 ? {} : { route } });
      return null;
    },
    desktop_quit_state: () => resolveQuitState(context),
    open_web_handoff: async (args) => {
      const url = requireString(args, "url");
      const deploymentUrl = requireString(args, "deploymentUrl", "deployment_url");
      if (!isAllowedWebHandoffUrl(url, deploymentUrl)) {
        throw new Error("Web handoff URL is not allowed");
      }
      await context.host.openExternal(url);
      return null;
    },
    quit_desktop: async (args) => {
      const choice = requireString(args, "choice");
      const state = resolveQuitState(context);
      validateQuitChoiceForState(choice, state);
      if (choice === "interrupt_and_quit") {
        context.managed.interruptAll();
        await context.codexTui.closeAll();
        context.codexServers.stopAll();
      }
      context.host.quitApplication();
      return null;
    },
    open_terminal_at_path: (args) => openTerminalAtPath(requireString(args, "path")),
    open_project_path: (args) => {
      const spec = buildOpenCommand(requireString(args, "path"));
      const child = spawnManagedSpec(spec, { ignoreOutput: true });
      return new Promise((resolvePromise, rejectPromise) => {
        child.once("error", (error) => rejectPromise(new Error(`Failed to run open command: ${error.message}`)));
        child.once("exit", (code) => {
          if (code === 0) resolvePromise();
          else rejectPromise(new Error(`Open command exited with status: exit code ${code ?? "unknown"}`));
        });
      });
    },
    launch_project_command: (args) => launchProjectCommand({
      host: context.host,
      registry: context.managed,
      cwd: requireString(args, "cwd"),
      command: requireString(args, "command"),
      taskId: requireString(args, "taskId", "task_id"),
      projectId: requireString(args, "projectId", "project_id"),
      workflowInstanceId: requireString(args, "workflowInstanceId", "workflow_instance_id"),
      sessionName: requireString(args, "sessionName", "session_name"),
      sessionType: requireString(args, "sessionType", "session_type")
    }),
    restore_tool_session: (args) => restoreToolSession({
      cwd: requireString(args, "cwd"),
      sessionName: requireString(args, "sessionName", "session_name"),
      sessionType: requireString(args, "sessionType", "session_type")
    })
  };
  return handlers;
}

// electron/lib/codex-app-server.ts
var import_node_child_process4 = require("node:child_process");
var import_node_crypto2 = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_path7 = require("node:path");
var import_node_readline2 = require("node:readline");

// electron/lib/codex-app-server-transport.ts
var import_node_path6 = require("node:path");
var import_node_url = require("node:url");

// ../../node_modules/.pnpm/ws@8.18.3/node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// electron/lib/codex-app-server-transport.ts
var DEFAULT_TRANSPORT_TIMEOUT_MS = 15e3;
function transportError(message, code = "provider_transport_error") {
  return Object.assign(new Error(message), { code });
}
function parseLoopbackWebSocket(value) {
  let endpoint;
  try {
    endpoint = new import_node_url.URL(value);
  } catch {
    throw transportError("Codex app-server endpoint is invalid");
  }
  if (endpoint.protocol !== "ws:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw transportError("Codex app-server endpoint is invalid");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw transportError("Codex app-server endpoint must be loopback");
  }
  if (!endpoint.port) {
    throw transportError("Codex app-server endpoint is invalid");
  }
  return endpoint;
}
function parseUnixEndpoint(value) {
  const prefix = "unix://";
  if (!value.startsWith(prefix)) {
    throw transportError("Codex app-server Unix endpoint is invalid");
  }
  const path = value.slice(prefix.length);
  if (!path || !(0, import_node_path6.isAbsolute)(path) || /[\u0000-\u001F\u007F]/u.test(path)) {
    throw transportError("Codex app-server Unix endpoint is invalid");
  }
  return path;
}
function parseAppServerListeningEndpoint(stdout) {
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /listening on:\s+(ws:\/\/[^\s]+|unix:\/\/[^\s]+)/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}
function codexWebSocketUrl(endpoint) {
  if (endpoint.startsWith("unix://")) {
    return `ws+unix://${parseUnixEndpoint(endpoint)}`;
  }
  return parseLoopbackWebSocket(endpoint).toString().replace(/\/$/u, "");
}
function createCodexAppServerTransport(input) {
  const endpoint = input.kind === "unix" ? `unix://${parseUnixEndpoint(input.endpoint)}` : parseLoopbackWebSocket(input.endpoint).toString().replace(/\/$/u, "");
  const socket = new wrapper_default(codexWebSocketUrl(endpoint));
  const messageHandlers = /* @__PURE__ */ new Set();
  const closeHandlers = /* @__PURE__ */ new Set();
  let readyPromise = null;
  let closed = false;
  let closeError = null;
  const notifyClose = (error) => {
    if (closeError === null && error) closeError = error;
    for (const handler of closeHandlers) handler(error);
  };
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      const error = transportError("Codex app-server transport received binary data");
      closeError = error;
      socket.close(1003, "binary data is not supported");
      notifyClose(error);
      return;
    }
    const line = typeof data === "string" ? data : data.toString("utf8");
    for (const handler of messageHandlers) handler(line);
  });
  socket.on("close", () => {
    closed = true;
    notifyClose(closeError);
  });
  socket.on("error", (error) => {
    const normalized = transportError(error.message || "Codex app-server socket failed");
    closeError = normalized;
    notifyClose(normalized);
  });
  return {
    kind: input.kind,
    endpoint,
    ready() {
      if (readyPromise) return readyPromise;
      readyPromise = new Promise((resolve2, reject) => {
        const timeoutMs = input.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          reject(transportError("Codex app-server transport did not become ready", "provider_start_timeout"));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off("open", onOpen);
          socket.off("error", onError);
        };
        const onOpen = () => {
          cleanup();
          resolve2();
        };
        const onError = (error) => {
          cleanup();
          reject(transportError(error.message || "Codex app-server socket failed"));
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
      });
      return readyPromise;
    },
    write(line) {
      if (closed || socket.readyState !== wrapper_default.OPEN) {
        return Promise.reject(transportError("Codex app-server transport is closed"));
      }
      return new Promise((resolve2, reject) => {
        socket.send(line, (error) => {
          if (error) reject(transportError(error.message || "Codex app-server write failed"));
          else resolve2();
        });
      });
    },
    close() {
      if (closed) return Promise.resolve();
      return new Promise((resolve2) => {
        socket.once("close", () => resolve2());
        socket.close();
        if (socket.readyState === wrapper_default.CONNECTING) {
          socket.terminate();
          resolve2();
        }
      });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    }
  };
}

// electron/lib/codex-app-server.ts
var MAX_JSON_RPC_LINE_BYTES = 4 * 1024 * 1024;
var MAX_STDERR_BYTES = 4 * 1024;
var REQUEST_TIMEOUT_MS = 3e4;
var STARTUP_TIMEOUT_MS = 15e3;
var PROBE_TIMEOUT_MS = 5e3;
var INDEPENDENT_AUTH_REFS = /* @__PURE__ */ new Set([
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT"
]);
function nowMs() {
  return Date.now();
}
function boundedErrorMessage(message) {
  const redacted = message.split(/\s+/u).map((token) => {
    const lower = token.toLowerCase();
    if (["key=", "token=", "secret=", "password=", "authorization="].some((prefix) => lower.startsWith(prefix))) {
      const separator = token.indexOf("=");
      return separator >= 0 ? `${token.slice(0, separator + 1)}[redacted]` : "[redacted]";
    }
    return token;
  }).join(" ");
  return [...redacted].slice(0, 512).join("");
}
function providerError(code, message, rpcCode) {
  return Object.assign(new Error(`${code}: ${boundedErrorMessage(message)}`), {
    code,
    ...rpcCode === void 0 ? {} : { rpcCode }
  });
}
function validateJsonRpcLine(line) {
  if (line.length > MAX_JSON_RPC_LINE_BYTES) {
    throw new Error("Codex app-server message size exceeds the limit");
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Codex app-server message is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex app-server message must be an object");
  }
  const object = value;
  if (object.jsonrpc !== void 0 && object.jsonrpc !== "2.0") {
    throw new Error("Codex app-server message has an unsupported JSON-RPC version");
  }
  const hasMethod = "method" in object;
  const hasResult = "result" in object;
  const hasError = "error" in object;
  if (hasMethod) {
    if (hasResult || hasError) {
      throw new Error("Codex app-server message cannot be both a request and a response");
    }
    const method = object.method;
    if (typeof method !== "string" || method.length === 0 || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw new Error("Codex app-server method is invalid");
    }
    if (object.id !== void 0 && !(typeof object.id === "number" && Number.isSafeInteger(object.id) || typeof object.id === "string" && object.id.length > 0 && object.id.length <= 128)) {
      throw new Error("Codex app-server request id is invalid");
    }
    return value;
  }
  const validId = typeof object.id === "number" && Number.isSafeInteger(object.id);
  if (!validId || hasResult === hasError) {
    throw new Error("Codex app-server response id or result is invalid");
  }
  if (object.error !== void 0) {
    const error = object.error;
    if (!error || typeof error !== "object" || !Number.isSafeInteger(error.code) || typeof error.message !== "string") {
      throw new Error("Codex app-server response error is invalid");
    }
  }
  return value;
}
function buildServerResponse(requestId, result, error) {
  const validId = typeof requestId === "string" && requestId.length > 0 || typeof requestId === "number" && Number.isSafeInteger(requestId);
  if (!validId || result !== void 0 === (error !== void 0)) {
    throw new Error("Codex app-server response is invalid");
  }
  if (error !== void 0) {
    const errorObject = error;
    if (!errorObject || typeof errorObject !== "object" || !Number.isSafeInteger(errorObject.code) || typeof errorObject.message !== "string") {
      throw new Error("Codex app-server response error is invalid");
    }
  }
  const response = { jsonrpc: "2.0", id: requestId };
  if (result !== void 0) response.result = result;
  if (error !== void 0) response.error = error;
  const serialized = JSON.stringify(response);
  if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
    throw new Error("Codex app-server response size exceeds the limit");
  }
  return serialized;
}
function sanitizeEnvironmentRefs(refs, independentCredentials) {
  return refs.filter((reference) => !independentCredentials || !INDEPENDENT_AUTH_REFS.has(reference));
}
function validateProcessKey2(value) {
  if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:.-]+$/u.test(value)) {
    throw new Error("Codex app-server process key is invalid");
  }
}
function validateModelSiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Codex local model site URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error("Codex local model site URL is invalid");
  }
}
function modelProviderArgs(baseUrl) {
  if (baseUrl === null) return [];
  validateModelSiteUrl(baseUrl);
  return [
    "--config",
    'model_provider="humanthread_local"',
    "--config",
    'model_providers.humanthread_local.name="HumanThread Desktop"',
    "--config",
    `model_providers.humanthread_local.base_url=${JSON.stringify(baseUrl)}`,
    "--config",
    'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
    "--config",
    'model_providers.humanthread_local.wire_api="responses"',
    "--config",
    "model_providers.humanthread_local.requires_openai_auth=false"
  ];
}
function buildAppServerArgs(input) {
  return ["app-server", "--listen", input.endpoint, ...modelProviderArgs(input.baseUrl)];
}
function validateRuntimeModel(model, independentCredentials) {
  if (independentCredentials && (model === null || model === void 0)) {
    throw new Error("Independent Codex execution requires an explicit model");
  }
  if (model !== null && model !== void 0) {
    if (model.length === 0 || model.length > 512 || /[\u0000-\u001F\u007F]/u.test(model)) {
      throw new Error("Selected Codex model is invalid");
    }
  }
}
function validateRuntimeEffort(effort) {
  if (effort !== null && effort !== void 0) {
    if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) {
      throw new Error("Selected Codex reasoning effort is invalid");
    }
  }
}
function bindingFingerprint(input, baseUrl) {
  const digest = (0, import_node_crypto2.createHash)("sha256");
  digest.update(input.credentialContext?.deploymentOrigin ?? "environment");
  digest.update("\0");
  digest.update(input.credentialContext?.userId ?? "environment");
  digest.update("\0");
  digest.update(input.credentialContext?.credentialRef ?? "environment");
  digest.update("\0");
  digest.update(baseUrl ?? "environment");
  digest.update("\0");
  digest.update(input.model ?? "environment");
  digest.update("\0");
  digest.update(input.reasoningEffort ?? "environment");
  return digest.digest("hex");
}
function unixSocketPath(directory, fingerprint) {
  (0, import_node_fs5.mkdirSync)(directory, { recursive: true, mode: 448 });
  const path = (0, import_node_path7.join)(directory, `${fingerprint}.sock`);
  try {
    if ((0, import_node_fs5.statSync)(path).isSocket()) (0, import_node_fs5.unlinkSync)(path);
  } catch {
  }
  return path;
}
function isMethodNotFound(error) {
  return error instanceof Error && Reflect.get(error, "rpcCode") === -32601;
}
var CodexAppServerRegistry = class {
  servers = /* @__PURE__ */ new Map();
  notificationHandlers = /* @__PURE__ */ new Set();
  host;
  constructor(host) {
    this.host = host;
  }
  snapshot(handle) {
    return {
      processKey: handle.processKey,
      generation: handle.generation,
      pid: handle.pid,
      bindingFingerprint: handle.bindingFingerprint,
      model: handle.model,
      reasoningEffort: handle.reasoningEffort,
      transport: handle.transportKind,
      endpoint: handle.endpoint,
      protocolVersion: handle.protocolVersion,
      status: handle.state.status,
      lastNotificationAt: handle.state.lastNotificationAt,
      pendingRequestCount: handle.pending.size,
      stderrSummary: handle.state.stderrSummary,
      lastErrorCode: handle.state.lastErrorCode
    };
  }
  emitState(handle) {
    this.host.send("codex_app_server_state", this.snapshot(handle));
  }
  rejectPending(handle, error) {
    for (const [id, entry] of handle.pending) {
      handle.pending.delete(id);
      entry.reject(error);
    }
  }
  markFailed(handle, code, message) {
    const bounded = boundedErrorMessage(message);
    handle.state.status = code === "provider_process_exit" ? "stopped" : "failed";
    handle.state.lastErrorCode = code;
    handle.state.stderrSummary = bounded;
    this.rejectPending(handle, providerError(code, bounded));
    this.emitState(handle);
  }
  handleRpcLine(handle, line) {
    let value;
    try {
      value = validateJsonRpcLine(line);
    } catch (error) {
      this.markFailed(handle, "provider_protocol_error", error.message);
      return;
    }
    const object = value;
    if (typeof object.method === "string") {
      handle.state.lastNotificationAt = nowMs();
      const notification = {
        processKey: handle.processKey,
        generation: handle.generation,
        method: object.method,
        params: object.params ?? null,
        requestId: typeof object.id === "number" || typeof object.id === "string" ? object.id : null,
        receivedAtMs: nowMs()
      };
      this.host.send("codex_app_server_notification", notification);
      for (const handler of this.notificationHandlers) handler(notification);
      this.emitState(handle);
      return;
    }
    if (typeof object.id !== "number" || !Number.isSafeInteger(object.id)) return;
    const entry = handle.pending.get(object.id);
    if (!entry) return;
    handle.pending.delete(object.id);
    if (object.error !== void 0) {
      const errorObject = object.error;
      const rpcCode = typeof errorObject.code === "number" ? errorObject.code : void 0;
      const message = typeof errorObject.message === "string" ? errorObject.message : "Codex app-server request failed";
      entry.reject(providerError("provider_rpc_error", message, rpcCode));
    } else if (object.result !== void 0) {
      entry.resolve(object.result);
    } else {
      entry.reject(providerError("provider_protocol_error", "Codex app-server response has no result"));
    }
  }
  attachEndpoint(handle, endpoint) {
    if (handle.transport || handle.endpointSettled) return;
    handle.endpoint = endpoint;
    let transport;
    try {
      const factory = this.host.transportFactory ?? createCodexAppServerTransport;
      transport = factory({
        kind: handle.transportKind,
        endpoint,
        timeoutMs: STARTUP_TIMEOUT_MS
      });
    } catch (error) {
      const failure = providerError("provider_transport_error", error.message);
      handle.endpointSettled = true;
      handle.rejectEndpoint(failure);
      this.markFailed(handle, failure.code, failure.message);
      return;
    }
    handle.transport = transport;
    transport.onMessage((line) => this.handleRpcLine(handle, line));
    transport.onClose((error) => {
      if (handle.state.status !== "stopped") {
        this.markFailed(
          handle,
          "provider_process_exit",
          error?.message ?? "Codex app-server daemon connection closed"
        );
      }
    });
    void transport.ready().then(() => {
      if (handle.endpointSettled) return;
      handle.endpointSettled = true;
      handle.resolveEndpoint(transport);
      this.emitState(handle);
    }).catch((error) => {
      if (handle.endpointSettled) return;
      handle.endpointSettled = true;
      handle.rejectEndpoint(providerError("provider_transport_error", error.message));
      this.markFailed(handle, "provider_transport_error", error.message);
    });
  }
  spawnReaders(handle) {
    if (!handle.child.stdout || !handle.child.stderr) return;
    const stdoutReader = (0, import_node_readline2.createInterface)({ input: handle.child.stdout });
    stdoutReader.on("line", (line) => {
      const endpoint = parseAppServerListeningEndpoint(line);
      if (endpoint) this.attachEndpoint(handle, endpoint);
    });
    stdoutReader.on("close", () => {
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_transport_error", "Codex app-server stdout closed"));
      }
    });
    let summary = "";
    const stderrReader = (0, import_node_readline2.createInterface)({ input: handle.child.stderr });
    stderrReader.on("line", (line) => {
      if (summary.length < MAX_STDERR_BYTES) summary += `${line}
`;
    });
    stderrReader.on("close", () => {
      if (summary.trim().length > 0) {
        handle.state.stderrSummary = boundedErrorMessage(summary);
        this.emitState(handle);
      }
    });
  }
  removeIfGeneration(processKey, generation) {
    const existing = this.servers.get(processKey);
    if (existing?.generation === generation) this.servers.delete(processKey);
  }
  get(processKey) {
    const handle = this.servers.get(processKey);
    if (!handle) throw providerError("provider_transport_error", "Codex app-server process is not running");
    return handle;
  }
  async transportFor(handle) {
    let timer;
    try {
      return await Promise.race([
        handle.endpointPromise,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(providerError(
            "provider_start_timeout",
            "Codex app-server endpoint is unavailable"
          )), STARTUP_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  start(input) {
    validateProcessKey2(input.processKey);
    validateEnvironmentRefs(input.environmentRefs ?? []);
    validateEnvironmentOverrides(input.environmentOverrides ?? {});
    const baseUrl = input.environmentOverrides?.OPENAI_BASE_URL ?? null;
    validateRuntimeModel(input.model, input.credentialContext !== void 0 && input.credentialContext !== null);
    validateRuntimeEffort(input.reasoningEffort);
    if (input.credentialContext && baseUrl === null) {
      throw new Error("Independent Codex credentials require the selected local model provider");
    }
    const binding = bindingFingerprint(input, baseUrl);
    const existing = this.servers.get(input.processKey);
    if (existing) {
      if (existing.bindingFingerprint === binding) return this.snapshot(existing);
      throw new Error("Codex app-server process key is already bound to another model site");
    }
    const transportKind = input.transport ?? "websocket";
    const resolution = resolveWorkspacePathImpl(input.cwd, input.cwd);
    const executable = (this.host.resolveExecutable ?? resolveCodexExecutable)(input.executable);
    let environmentRefs = sanitizeEnvironmentRefs(input.environmentRefs ?? [], Boolean(input.credentialContext));
    const environmentOverrides = { ...input.environmentOverrides ?? {} };
    if (input.credentialContext) {
      const context = input.credentialContext;
      const apiKey = readAgentCredential(context.deploymentOrigin, context.userId, context.credentialRef);
      const codexHome = prepareIsolatedCodexHome(context.deploymentOrigin, context.userId);
      if (input.checklistMcp) {
        writeIsolatedChecklistMcpConfig(codexHome, input.checklistMcp.url, input.checklistMcp.headers);
      }
      environmentRefs = sanitizeEnvironmentRefs(environmentRefs, true);
      environmentOverrides.OPENAI_API_KEY = apiKey;
      environmentOverrides.CODEX_HOME = codexHome;
    } else if (input.isolationContext && input.checklistMcp) {
      const codexHome = prepareIsolatedCodexHome(
        input.isolationContext.deploymentOrigin,
        input.isolationContext.userId
      );
      writeIsolatedChecklistMcpConfig(codexHome, input.checklistMcp.url, input.checklistMcp.headers);
      environmentRefs = sanitizeEnvironmentRefs(environmentRefs, true);
      environmentOverrides.CODEX_HOME = codexHome;
    }
    const endpoint = transportKind === "unix" ? `unix://${unixSocketPath(
      this.host.socketDirectory ?? (0, import_node_path7.join)(resolution.targetRealpath, ".humanthread", "codex-daemon"),
      binding
    )}` : "ws://127.0.0.1:0";
    const args = buildAppServerArgs({ transport: transportKind, endpoint, baseUrl });
    const spec = buildCodexCommandWithOverrides({
      executable,
      cwd: resolution.targetRealpath,
      args,
      inheritedPath: process.env.PATH,
      environmentRefs,
      environmentOverrides
    });
    let resolveEndpoint;
    let rejectEndpoint;
    const endpointPromise = new Promise((resolve2, reject) => {
      resolveEndpoint = resolve2;
      rejectEndpoint = reject;
    });
    const child = (this.host.spawn ?? import_node_child_process4.spawn)(spec.program, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true
    });
    const handle = {
      processKey: input.processKey,
      generation: nowMs(),
      pid: child.pid ?? 0,
      bindingFingerprint: binding,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      transportKind,
      endpoint: null,
      protocolVersion: null,
      child,
      transport: null,
      endpointPromise,
      resolveEndpoint,
      rejectEndpoint,
      endpointSettled: false,
      pending: /* @__PURE__ */ new Map(),
      nextId: 1,
      state: {
        status: "starting",
        lastNotificationAt: null,
        stderrSummary: null,
        lastErrorCode: null
      }
    };
    this.servers.set(input.processKey, handle);
    this.spawnReaders(handle);
    child.once("exit", (code, signal) => {
      const label = code !== null ? String(code) : signal ?? "signal";
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_process_exit", label));
      }
      this.markFailed(handle, "provider_process_exit", `Codex app-server exited with ${label}`);
      this.removeIfGeneration(input.processKey, handle.generation);
    });
    child.once("error", (error) => {
      if (!handle.endpointSettled) {
        handle.endpointSettled = true;
        handle.rejectEndpoint(providerError("provider_process_wait_failed", error.message));
      }
      this.markFailed(handle, "provider_process_wait_failed", error.message);
      this.removeIfGeneration(input.processKey, handle.generation);
    });
    this.emitState(handle);
    return this.snapshot(handle);
  }
  async request(processKey, method, params) {
    if (method.length === 0 || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw new Error("Codex app-server method is invalid");
    }
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const id = handle.nextId;
    handle.nextId += 1;
    const serialized = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
      throw new Error("Codex app-server request size exceeds the limit");
    }
    const responsePromise = new Promise((resolvePromise, rejectPromise) => {
      handle.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
    try {
      await transport.write(`${serialized}
`);
    } catch (error) {
      handle.pending.delete(id);
      throw providerError("provider_transport_error", error.message);
    }
    const timeoutMs = method === "initialize" ? STARTUP_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    let timer;
    let result;
    try {
      result = await Promise.race([
        responsePromise,
        new Promise((_resolvePromise, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(providerError(
            "provider_request_timeout",
            method === "initialize" ? "Codex app-server initialize timed out" : "Codex app-server request timed out"
          )), timeoutMs);
        })
      ]);
    } catch (error) {
      handle.pending.delete(id);
      if (error instanceof Error && error.message.startsWith("provider_request_timeout:") && method === "initialize") {
        this.markFailed(handle, "provider_start_timeout", error.message);
        try {
          handle.child.kill("SIGKILL");
        } catch {
        }
        this.removeIfGeneration(processKey, handle.generation);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (method === "initialize") {
      const response = result && typeof result === "object" && !Array.isArray(result) ? result : null;
      handle.protocolVersion = typeof response?.userAgent === "string" ? boundedErrorMessage(response.userAgent) : null;
      handle.state.status = "ready";
      this.emitState(handle);
    }
    return result;
  }
  async notify(processKey, method, params) {
    if (method.length === 0 || method.length > 256 || /[\u0000-\u001F\u007F]/u.test(method)) {
      throw new Error("Codex app-server method is invalid");
    }
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const request = { jsonrpc: "2.0", method };
    if (params !== null && params !== void 0) request.params = params;
    const serialized = JSON.stringify(request);
    if (serialized.length > MAX_JSON_RPC_LINE_BYTES) {
      throw new Error("Codex app-server notification size exceeds the limit");
    }
    try {
      await transport.write(`${serialized}
`);
    } catch (error) {
      throw providerError("provider_transport_error", error.message);
    }
  }
  async respond(processKey, requestId, result, error) {
    const handle = this.get(processKey);
    const transport = await this.transportFor(handle);
    const serialized = buildServerResponse(requestId, result, error);
    try {
      await transport.write(`${serialized}
`);
    } catch (writeError) {
      throw providerError("provider_transport_error", writeError.message);
    }
  }
  async cancel(processKey, threadId, turnId) {
    const params = { threadId };
    if (turnId !== void 0) params.turnId = turnId;
    await this.request(processKey, "turn/interrupt", params);
  }
  subscribe(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }
  state(processKey) {
    const handle = this.servers.get(processKey);
    return handle ? this.snapshot(handle) : null;
  }
  async probeCapabilities(processKey, executable) {
    const processHandle = `probe:${processKey}:${nowMs()}`;
    const resolvedExecutable = (this.host.resolveExecutable ?? resolveCodexExecutable)(executable);
    try {
      await this.request(processKey, "process/spawn", {
        command: [resolvedExecutable, "--version"],
        processHandle,
        cwd: process.cwd(),
        tty: false,
        streamStdin: false,
        streamStdoutStderr: false,
        outputBytesCap: 4096,
        timeoutMs: PROBE_TIMEOUT_MS
      });
    } catch (error) {
      if (isMethodNotFound(error)) {
        throw providerError("provider_tui_unsupported", "Codex app-server does not support process/spawn");
      }
      throw error;
    } finally {
      await this.request(processKey, "process/kill", { processHandle }).catch(() => void 0);
    }
  }
  stop(processKey) {
    const handle = this.servers.get(processKey);
    if (!handle) return;
    this.servers.delete(processKey);
    this.rejectPending(handle, providerError("provider_transport_error", "Codex app-server stopped"));
    void handle.transport?.close().catch(() => void 0);
    try {
      handle.child.kill("SIGKILL");
    } catch {
    }
    handle.state.status = "stopped";
    this.emitState(handle);
  }
  states() {
    return [...this.servers.values()].map((handle) => this.snapshot(handle));
  }
  hasRunning() {
    return this.servers.size > 0;
  }
  stopAll() {
    for (const processKey of [...this.servers.keys()]) this.stop(processKey);
  }
};

// electron/lib/codex-tui-broker.ts
var import_node_path8 = require("node:path");
var DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
var MAX_WRITE_BYTES = 256 * 1024;
function providerError2(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
function validateIdentifier(value, label) {
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw providerError2("provider_tui_invalid", `${label} is invalid`);
  }
}
function validateSessionInput(input) {
  validateIdentifier(input.sessionId, "TUI session id");
  validateIdentifier(input.runId, "AgentRun id");
  validateIdentifier(input.processKey, "Codex daemon key");
  validateIdentifier(input.threadId, "Codex thread id");
  if (!(0, import_node_path8.isAbsolute)(input.cwd) || /[\u0000-\u001F\u007F]/u.test(input.cwd)) {
    throw providerError2("provider_tui_invalid", "TUI working directory is invalid");
  }
  for (const value of [input.taskId, input.projectId, input.nodeKey, input.model]) {
    if (value !== null) validateIdentifier(value, "TUI session metadata");
  }
}
function validateWindowId(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId <= 0) {
    throw providerError2("provider_tui_invalid", "Desktop window id is invalid");
  }
}
function decodeBase64(value, maxBytes = MAX_WRITE_BYTES) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw providerError2("provider_tui_invalid", "TUI input is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw providerError2("provider_tui_invalid", "TUI input is invalid");
  }
  return bytes;
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function createCodexTuiBroker(options) {
  const executable = options.executable.trim();
  if (!executable || /[\u0000-\u001F\u007F]/u.test(executable)) {
    throw providerError2("provider_tui_invalid", "Codex executable is invalid");
  }
  if (!(0, import_node_path8.isAbsolute)(options.viewerHome)) {
    throw providerError2("provider_tui_invalid", "Codex viewer home is invalid");
  }
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1) {
    throw providerError2("provider_tui_invalid", "Codex TUI buffer limit is invalid");
  }
  const now = options.now ?? Date.now;
  let handleCounter = 0;
  const probedGenerations = /* @__PURE__ */ new Set();
  const sessions = /* @__PURE__ */ new Map();
  const unsubscribe = options.appServer.subscribe((notification) => {
    const params = record(notification.params);
    if (!params || typeof params.processHandle !== "string") return;
    const session = [...sessions.values()].find((entry) => entry.processHandle === params.processHandle);
    if (!session) return;
    if (notification.processKey !== session.processKey || session.generation !== null && notification.generation !== session.generation) {
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = "interrupted";
      options.emit?.("codex_tui_state", view(session));
      return;
    }
    session.lastActivityAtMs = notification.receivedAtMs;
    if (notification.method === "process/outputDelta") {
      const deltaBase64 = typeof params.deltaBase64 === "string" ? params.deltaBase64 : null;
      if (!deltaBase64) return;
      const decoded = Buffer.from(deltaBase64, "base64");
      if (decoded.length === 0) return;
      void options.journal?.append(session.sessionId, decoded).catch(() => void 0);
      void options.onSessionOutput?.({ sessionId: session.sessionId, bytes: decoded });
      session.chunks.push(decoded);
      session.bufferBytes += decoded.length;
      while (session.bufferBytes > maxBufferBytes && session.chunks.length > 1) {
        const removed = session.chunks.shift();
        session.bufferBytes -= removed?.length ?? 0;
      }
      if (session.bufferBytes > maxBufferBytes && session.chunks.length === 1) {
        const only = session.chunks[0];
        session.chunks[0] = only.subarray(only.length - maxBufferBytes);
        session.bufferBytes = session.chunks[0].length;
      }
      options.emit?.("codex_tui_output", {
        sessionId: session.sessionId,
        stream: params.stream === "stderr" ? "stderr" : "stdout",
        deltaBase64,
        receivedAtMs: notification.receivedAtMs
      });
      options.emit?.("codex_tui_state", view(session));
      return;
    }
    if (notification.method === "process/exited") {
      const exitCode = typeof params.exitCode === "number" ? params.exitCode : null;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = exitCode === 0 ? "detached" : "interrupted";
      options.emit?.("codex_tui_state", view(session));
    }
  });
  function sessionOrThrow(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw providerError2("provider_tui_not_found", "Codex TUI session was not found");
    return session;
  }
  function view(session) {
    return {
      sessionId: session.sessionId,
      runId: session.runId,
      taskId: session.taskId,
      projectId: session.projectId,
      nodeKey: session.nodeKey,
      processKey: session.processKey,
      threadId: session.threadId,
      cwd: session.cwd,
      model: session.model,
      status: session.status,
      controlState: session.status === "running" ? session.controllerWindowId === null ? "viewer" : "controller" : "detached",
      controllerWindowId: session.controllerWindowId,
      attachedCount: session.attachedWindows.size,
      lastActivityAtMs: session.lastActivityAtMs,
      bufferBytes: session.bufferBytes,
      generation: session.generation
    };
  }
  function replay(session) {
    return Buffer.concat(session.chunks, session.bufferBytes).toString("base64");
  }
  return {
    register(input) {
      validateSessionInput(input);
      const existing = sessions.get(input.sessionId);
      if (existing?.processHandle) {
        throw providerError2("provider_tui_conflict", "Codex TUI session is already running");
      }
      sessions.set(input.sessionId, {
        ...input,
        generation: null,
        finished: false,
        processHandle: null,
        status: "detached",
        controllerWindowId: null,
        attachedWindows: /* @__PURE__ */ new Set(),
        chunks: [],
        bufferBytes: 0,
        lastActivityAtMs: null
      });
    },
    unregister(sessionId) {
      sessions.delete(sessionId);
    },
    async freeze(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return;
      const processHandle = session.processHandle;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.finished = true;
      session.status = "completed";
      if (processHandle) {
        await options.appServer.request(session.processKey, "process/kill", { processHandle }).catch(() => void 0);
      }
      options.emit?.("codex_tui_state", view(session));
    },
    list() {
      return [...sessions.values()].sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0)).map(view);
    },
    session(sessionId) {
      const session = sessions.get(sessionId);
      return session ? view(session) : null;
    },
    async start(input) {
      validateSessionInput(input);
      if (!sessions.has(input.sessionId)) {
        sessions.set(input.sessionId, {
          ...input,
          generation: null,
          finished: false,
          processHandle: null,
          status: "detached",
          controllerWindowId: null,
          attachedWindows: /* @__PURE__ */ new Set(),
          chunks: [],
          bufferBytes: 0,
          lastActivityAtMs: null
        });
      }
      const session = sessionOrThrow(input.sessionId);
      if (session.finished) {
        throw providerError2(
          "provider_tui_completed",
          "Codex TUI session is complete and cannot be resumed"
        );
      }
      if (session.processHandle && session.status === "running") return view(session);
      return this.spawn({ ...input, windowId: 1 });
    },
    async spawn(input) {
      validateWindowId(input.windowId);
      const session = sessionOrThrow(input.sessionId);
      if (session.runId !== input.runId || session.processKey !== input.processKey || session.threadId !== input.threadId || session.cwd !== input.cwd) {
        throw providerError2("provider_tui_conflict", "Codex TUI session binding changed");
      }
      if (session.processHandle && session.status === "running") return view(session);
      const state = options.appServer.state(session.processKey);
      if (!state?.endpoint || !["websocket", "unix"].includes(state.transport)) {
        throw providerError2("provider_tui_unavailable", "Codex daemon endpoint is unavailable");
      }
      if (session.generation !== null && session.generation !== state.generation) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
        throw providerError2(
          "provider_tui_generation_stale",
          "Codex daemon generation changed after this TUI session was created"
        );
      }
      const capabilityKey = `${session.processKey}:${state.generation}`;
      if (!probedGenerations.has(capabilityKey) && options.appServer.probeCapabilities) {
        await options.appServer.probeCapabilities(session.processKey, executable);
        probedGenerations.add(capabilityKey);
      }
      const processHandle = (options.createProcessHandle ?? ((sessionId) => `tui:${sessionId}:${++handleCounter}`))(session.sessionId);
      validateIdentifier(processHandle, "TUI process handle");
      session.status = "starting";
      session.controllerWindowId = null;
      const modelArguments = session.model?.trim() ? ["-m", session.model.trim()] : [];
      await options.appServer.request(session.processKey, "process/spawn", {
        // The TUI is a second `codex` process and does not inherit the
        // app-server's model, so it must be told explicitly; otherwise it shows
        // Codex's own default instead of the model the user selected.
        command: [
          executable,
          "resume",
          session.threadId,
          "--remote",
          state.endpoint,
          "--cd",
          session.cwd,
          ...modelArguments
        ],
        processHandle,
        cwd: session.cwd,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        outputBytesCap: maxBufferBytes,
        timeoutMs: null,
        env: {
          CODEX_HOME: options.viewerHome,
          OPENAI_API_KEY: null,
          OPENAI_BASE_URL: null,
          OPENAI_ORGANIZATION: null,
          OPENAI_PROJECT: null,
          TERM: "xterm-256color"
        },
        size: { rows: 30, cols: 100 }
      });
      session.processHandle = processHandle;
      session.generation = state.generation;
      session.status = "running";
      session.lastActivityAtMs = now();
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    attach(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      const state = options.appServer.state(session.processKey);
      if (!state || session.generation !== null && session.generation !== state.generation) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
      }
      session.attachedWindows.add(windowId);
      return { session: view(session), replayBase64: replay(session) };
    },
    detach(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      session.attachedWindows.delete(windowId);
      if (session.controllerWindowId === windowId) session.controllerWindowId = null;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    async write(sessionId, windowId, deltaBase64) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      if (!session.processHandle || session.status !== "running") {
        throw providerError2("provider_tui_detached", "Codex TUI session is not running");
      }
      if (session.controllerWindowId !== windowId) {
        throw providerError2("provider_tui_control_required", "Codex TUI control lease is required");
      }
      decodeBase64(deltaBase64);
      await options.appServer.request(session.processKey, "process/writeStdin", {
        processHandle: session.processHandle,
        deltaBase64
      });
    },
    async resize(sessionId, windowId, rows, cols) {
      validateWindowId(windowId);
      if (!Number.isSafeInteger(rows) || rows < 1 || rows > 500 || !Number.isSafeInteger(cols) || cols < 1 || cols > 1e3) {
        throw providerError2("provider_tui_invalid", "TUI terminal size is invalid");
      }
      const session = sessionOrThrow(sessionId);
      if (!session.processHandle || session.status !== "running") {
        throw providerError2("provider_tui_detached", "Codex TUI session is not running");
      }
      if (session.controllerWindowId !== windowId) {
        throw providerError2("provider_tui_control_required", "Codex TUI control lease is required");
      }
      await options.appServer.request(session.processKey, "process/resizePty", {
        processHandle: session.processHandle,
        size: { rows, cols }
      });
    },
    acquire(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      session.controllerWindowId = windowId;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    release(sessionId, windowId) {
      validateWindowId(windowId);
      const session = sessionOrThrow(sessionId);
      if (session.controllerWindowId === windowId) session.controllerWindowId = null;
      const current = view(session);
      options.emit?.("codex_tui_state", current);
      return current;
    },
    async close(sessionId) {
      const session = sessionOrThrow(sessionId);
      const processHandle = session.processHandle;
      session.processHandle = null;
      session.controllerWindowId = null;
      session.status = "detached";
      if (processHandle) {
        await options.appServer.request(session.processKey, "process/kill", { processHandle }).catch(() => void 0);
      }
      options.emit?.("codex_tui_state", view(session));
    },
    async reattach(sessionId, windowId) {
      const session = sessionOrThrow(sessionId);
      if (session.finished) {
        throw providerError2(
          "provider_tui_completed",
          "Codex TUI session is complete and cannot be resumed"
        );
      }
      const state = options.appServer.state(session.processKey);
      if (!state?.endpoint || !["websocket", "unix"].includes(state.transport)) {
        throw providerError2("provider_tui_unavailable", "Codex daemon endpoint is unavailable");
      }
      if (session.generation !== null && session.generation !== state.generation) {
        session.status = "interrupted";
        session.processHandle = null;
        session.controllerWindowId = null;
        throw providerError2(
          "provider_tui_generation_stale",
          "Codex daemon generation changed after this TUI session was created"
        );
      }
      return this.spawn({
        sessionId,
        runId: session.runId,
        taskId: session.taskId,
        projectId: session.projectId,
        nodeKey: session.nodeKey,
        processKey: session.processKey,
        threadId: session.threadId,
        cwd: session.cwd,
        model: session.model,
        windowId
      });
    },
    async closeAll() {
      await Promise.all([...sessions.keys()].map((sessionId) => this.close(sessionId)));
    },
    dispose() {
      unsubscribe();
      sessions.clear();
    }
  };
}

// electron/lib/live-session-connector.ts
var SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
function connectorError(code, message) {
  return Object.assign(new Error(message), { code });
}
function validateRelayUrl(value, sessionId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw connectorError("internal_connector_offline", "Relay URL is invalid");
  }
  if (url.protocol !== "wss:") throw connectorError("internal_connector_offline", "Relay must use WSS");
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}
function createLiveSessionConnector(input) {
  if (!SESSION_ID_PATTERN.test(input.sessionId)) throw connectorError("live_session_invalid", "Live session id is invalid");
  if (!input.authorization.trim()) throw connectorError("internal_connector_offline", "Relay authorization is required");
  if (!Number.isSafeInteger(input.heartbeatMs) || input.heartbeatMs < 250) {
    throw connectorError("live_session_invalid", "Connector heartbeat interval is invalid");
  }
  const url = validateRelayUrl(input.relayUrl, input.sessionId);
  const connect = input.connect ?? ((connection) => new wrapper_default(connection.url, { headers: connection.headers }));
  let socket = null;
  let status = "closed";
  let control = "viewer";
  let heartbeatTimer = null;
  const sendControl = (payload) => {
    if (!socket || socket.readyState !== wrapper_default.OPEN) return;
    socket.send(JSON.stringify(payload));
  };
  return {
    async start() {
      if (status !== "closed" && status !== "reconnecting") return;
      status = "connecting";
      socket = connect({
        url,
        headers: { authorization: input.authorization }
      });
      socket.on("open", () => {
        status = "online";
        control = "viewer";
        sendControl({
          type: "execution.hello",
          protocol: 1,
          sessionId: input.sessionId,
          lastSequence: 0,
          at: input.now().toISOString()
        });
      });
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        let message;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (message.type === "control.claimed") {
          control = "controller";
          input.onControl("controller");
          return;
        }
        if (message.type === "control.released") {
          control = "viewer";
          input.onControl("viewer");
          return;
        }
        if (message.type === "control.input" && control === "controller" && typeof message.bytesBase64 === "string") {
          const bytes = Buffer.from(message.bytesBase64, "base64");
          if (bytes.byteLength > 0 && bytes.byteLength <= 256 * 1024) void input.onInput(bytes);
        }
        if (message.type === "control.resize" && control === "controller") {
          const rows = message.rows;
          const cols = message.cols;
          if (typeof rows === "number" && typeof cols === "number") void input.onResize?.({ rows, cols });
        }
      });
      socket.on("close", () => {
        status = "reconnecting";
        control = "viewer";
        input.onControl("viewer");
      });
      socket.on("error", () => {
        status = "reconnecting";
      });
      heartbeatTimer = setInterval(() => {
        void this.heartbeat();
      }, input.heartbeatMs);
      heartbeatTimer.unref?.();
    },
    async heartbeat() {
      sendControl({
        type: "execution.heartbeat",
        sessionId: input.sessionId,
        at: input.now().toISOString()
      });
    },
    async publish(bytes) {
      if (bytes.byteLength === 0) return;
      if (!socket || socket.readyState !== wrapper_default.OPEN || status !== "online") {
        throw connectorError("internal_connector_offline", "Relay connection is offline");
      }
      socket.send(bytes);
    },
    async close() {
      status = "closed";
      control = "viewer";
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket?.close(1e3, "desktop closed");
      socket = null;
    },
    state() {
      return status;
    }
  };
}

// electron/lib/live-session-runtime.ts
function createLiveSessionRuntime(input) {
  const connectors = /* @__PURE__ */ new Map();
  return {
    async publish(output) {
      const connector = connectors.get(output.sessionId);
      if (!connector) return;
      await connector.publish(output.bytes);
    },
    async open(binding) {
      if (connectors.has(binding.sessionId)) return;
      const connector = createLiveSessionConnector({
        relayUrl: binding.relayUrl,
        sessionId: binding.sessionId,
        authorization: binding.authorization,
        heartbeatMs: input.heartbeatMs ?? 15e3,
        now: () => /* @__PURE__ */ new Date(),
        onControl: () => void 0,
        onInput: async (bytes) => {
          const session = input.broker.session(binding.sessionId);
          if (!session || session.status !== "running") {
            throw Object.assign(new Error("Live session target is not running"), { code: "provider_tui_detached" });
          }
          await input.broker.write(binding.sessionId, 1, Buffer.from(bytes).toString("base64"));
        },
        onResize: async (size) => {
          const session = input.broker.session(binding.sessionId);
          if (!session || session.status !== "running") {
            throw Object.assign(new Error("Live session target is not running"), { code: "provider_tui_detached" });
          }
          await input.broker.resize(binding.sessionId, 1, size.rows, size.cols);
        }
      });
      connectors.set(binding.sessionId, connector);
      await connector.start();
    },
    async close(sessionId) {
      const connector = connectors.get(sessionId);
      connectors.delete(sessionId);
      await connector?.close().catch(() => void 0);
      await input.journal.remove(sessionId).catch(() => void 0);
    },
    async closeAll() {
      await Promise.all([...connectors.keys()].map((sessionId) => this.close(sessionId)));
    },
    state(sessionId) {
      return connectors.get(sessionId)?.state() ?? null;
    }
  };
}

// electron/lib/codex-tui-viewer-home.ts
var import_node_fs6 = require("node:fs");
var import_node_path9 = require("node:path");
function prepareCodexTuiViewerHome(rootDirectory) {
  const home = (0, import_node_path9.join)(rootDirectory, "codex-tui-viewer");
  (0, import_node_fs6.mkdirSync)(home, { recursive: true, mode: 448 });
  const configPath = (0, import_node_path9.join)(home, "config.toml");
  if (!(0, import_node_fs6.existsSync)(configPath)) {
    (0, import_node_fs6.writeFileSync)(configPath, "check_for_update_on_startup = false\n", { mode: 384 });
  }
  return home;
}

// ../../packages/live-session-journal/dist/journal.js
var import_promises = require("node:fs/promises");
var import_node_path10 = require("node:path");
var SESSION_ID_PATTERN2 = /^[a-f0-9]{32}$/u;
var DEFAULT_RETENTION_DAYS = 30;
var MAX_RETENTION_DAYS = 3650;
function journalError(code, message) {
  return Object.assign(new Error(message), { code });
}
function validateSessionId(sessionId) {
  if (!SESSION_ID_PATTERN2.test(sessionId))
    throw journalError("live_session_invalid", "Live session id is invalid");
  return sessionId;
}
function validateRetentionDays(value) {
  const days = value ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    throw journalError("live_session_invalid", "Journal retention must be between 1 and 3650 days");
  }
  return days;
}
function decodeLine(line) {
  if (!line.trim())
    return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(parsed.sequence) || Number(parsed.sequence) < 1 || typeof parsed.dataBase64 !== "string")
    return null;
  const bytes = Buffer.from(parsed.dataBase64, "base64");
  if (bytes.toString("base64").replace(/=+$/u, "") !== parsed.dataBase64.replace(/=+$/u, ""))
    return null;
  return { sequence: Number(parsed.sequence), bytes };
}
var LiveSessionJournal = class {
  #rootDirectory;
  #retentionDays;
  #locks = /* @__PURE__ */ new Map();
  constructor(input) {
    if (!(0, import_node_path10.isAbsolute)(input.rootDirectory) || /[\u0000-\u001F\u007F]/u.test(input.rootDirectory)) {
      throw journalError("live_session_invalid", "Journal root directory must be absolute");
    }
    this.#rootDirectory = input.rootDirectory;
    this.#retentionDays = validateRetentionDays(input.retentionDays);
  }
  sessionDirectory(sessionId) {
    return (0, import_node_path10.join)(this.#rootDirectory, validateSessionId(sessionId));
  }
  async append(sessionId, bytes) {
    validateSessionId(sessionId);
    if (bytes.byteLength === 0)
      return this.state(sessionId);
    return this.#withLock(sessionId, async () => {
      const directory = this.sessionDirectory(sessionId);
      await (0, import_promises.mkdir)(directory, { recursive: true, mode: 448 });
      const current = await this.read(sessionId);
      const sequence = current.lastSequence + 1;
      const line = `${JSON.stringify({ sequence, dataBase64: Buffer.from(bytes).toString("base64") })}
`;
      const handle = await (0, import_promises.open)((0, import_node_path10.join)(directory, "journal.ndjson"), "a", 384);
      try {
        await handle.write(line, void 0, "utf8");
      } finally {
        await handle.close();
      }
      return {
        ...current,
        status: current.status === "replay_unavailable" ? "degraded" : current.status,
        firstSequence: current.firstSequence === 0 ? sequence : current.firstSequence,
        lastSequence: sequence,
        bytes: current.bytes + bytes.byteLength
      };
    });
  }
  async read(sessionId, afterSequence = 0) {
    validateSessionId(sessionId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw journalError("live_session_invalid", "Journal cursor is invalid");
    }
    let content;
    try {
      content = await (0, import_promises.readFile)((0, import_node_path10.join)(this.sessionDirectory(sessionId), "journal.ndjson"), "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return {
          status: "ready",
          retentionDays: this.#retentionDays,
          firstSequence: 0,
          lastSequence: 0,
          bytes: 0,
          chunks: []
        };
      }
      throw error;
    }
    const chunks = [];
    let malformed = 0;
    for (const line of content.split("\n")) {
      const decoded = decodeLine(line);
      if (!decoded) {
        if (line.trim())
          malformed += 1;
        continue;
      }
      if (decoded.sequence > afterSequence)
        chunks.push(decoded);
    }
    const ordered = chunks.every((chunk, index) => index === 0 || chunk.sequence === chunks[index - 1].sequence + 1);
    const gap = chunks.some((chunk, index) => {
      if (index === 0)
        return afterSequence > 0 && chunk.sequence !== afterSequence + 1;
      return chunk.sequence !== chunks[index - 1].sequence + 1;
    });
    const status = gap || malformed > 1 ? "replay_unavailable" : malformed === 1 ? "degraded" : "ready";
    const sequences = chunks.map((chunk) => chunk.sequence);
    return {
      status,
      retentionDays: this.#retentionDays,
      firstSequence: sequences[0] ?? 0,
      lastSequence: sequences.at(-1) ?? 0,
      bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0),
      chunks: ordered ? chunks : []
    };
  }
  async state(sessionId) {
    const result = await this.read(sessionId);
    return {
      status: result.status,
      retentionDays: result.retentionDays,
      firstSequence: result.firstSequence,
      lastSequence: result.lastSequence,
      bytes: result.bytes
    };
  }
  async remove(sessionId) {
    validateSessionId(sessionId);
    await (0, import_promises.rm)(this.sessionDirectory(sessionId), { recursive: true, force: true });
    this.#locks.delete(sessionId);
  }
  async cleanup(input) {
    const now = input.now ?? /* @__PURE__ */ new Date();
    const cutoff = now.getTime() - this.#retentionDays * 24 * 60 * 60 * 1e3;
    let entries;
    try {
      entries = await (0, import_promises.readdir)(this.#rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
    const removed = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN2.test(entry.name) || input.activeSessionIds.has(entry.name))
        continue;
      const info = await (0, import_promises.stat)((0, import_node_path10.join)(this.#rootDirectory, entry.name));
      if (info.mtimeMs >= cutoff)
        continue;
      await this.remove(entry.name);
      removed.push(entry.name);
    }
    return removed;
  }
  async #withLock(sessionId, action) {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve2) => {
      release = resolve2;
    });
    this.#locks.set(sessionId, previous.then(() => gate));
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(sessionId) === gate)
        this.#locks.delete(sessionId);
    }
  }
};

// electron/main.ts
var APP_PROTOCOL = "humanthread";
var mainWindow = null;
var tray = null;
var isQuitting = false;
var pendingDeepLinks = [];
var trayState = {
  items: [
    { id: "status", label: "\u6B63\u5728\u8FDE\u63A5 \xB7 \u68C0\u67E5\u8BBE\u5907", enabled: false },
    { id: "current-task", label: "\u6682\u65E0\u5F53\u524D\u4EFB\u52A1", enabled: false },
    { id: "toggle-window", label: "\u9690\u85CF\u7A97\u53E3", enabled: true },
    { id: "self-check", label: "\u8FD0\u884C\u684C\u9762\u81EA\u68C0", enabled: true },
    { id: "quit", label: "\u9000\u51FA HumanThread", enabled: true }
  ]
};
function resourcePath(name) {
  return (0, import_node_path11.join)(__dirname, "..", "build-resources", name);
}
function emitEvent(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("humanthread:event", { event, data: payload });
  }
}
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  emitEvent("desktop_window_visibility", true);
}
function normalizeDeepLink(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  return value.startsWith(`${APP_PROTOCOL}://`) ? value : null;
}
function collectDeepLinksFromArgv(argv) {
  return argv.map((argument) => normalizeDeepLink(argument)).filter((value) => value !== null);
}
function dispatchDeepLinks(urls) {
  const valid = urls.map((url) => normalizeDeepLink(url)).filter((value) => value !== null);
  if (valid.length === 0) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    if (mainWindow.webContents.isLoading()) {
      pendingDeepLinks.push(...valid);
    } else {
      mainWindow.webContents.send("humanthread:deep-link", valid);
    }
  } else {
    pendingDeepLinks.push(...valid);
  }
}
function buildTrayMenu() {
  return import_electron2.Menu.buildFromTemplate(
    trayState.items.map((item) => ({
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      click: () => handleTrayAction(item.id)
    }))
  );
}
function handleTrayAction(id) {
  if (id === "toggle-window") {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      emitEvent("desktop_window_visibility", false);
    } else {
      showMainWindow();
    }
    return;
  }
  if (id === "current-task") {
    showMainWindow();
    emitEvent("desktop_tray_action", "current-task");
    return;
  }
  if (id === "self-check") {
    showMainWindow();
    emitEvent("desktop_tray_action", "self-check");
    return;
  }
  if (id === "quit") {
    showMainWindow();
    emitEvent("desktop_quit_requested", null);
  }
}
function setupTray() {
  const iconPath = resourcePath("trayTemplate.png");
  const icon = (0, import_node_fs7.existsSync)(iconPath) ? import_electron2.nativeImage.createFromPath(iconPath) : import_electron2.nativeImage.createEmpty();
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new import_electron2.Tray(icon);
  tray.setToolTip("HumanThread Desktop");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (process.platform !== "darwin") handleTrayAction("toggle-window");
  });
}
var storeCache = /* @__PURE__ */ new Map();
function storePath(name) {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(name)) {
    throw new Error("Native store name is invalid");
  }
  const directory = (0, import_node_path11.join)(import_electron2.app.getPath("userData"), "stores");
  (0, import_node_fs7.mkdirSync)(directory, { recursive: true });
  return (0, import_node_path11.join)(directory, name);
}
function loadStoreDocument(name) {
  const cached = storeCache.get(name);
  if (cached) return cached;
  const path = storePath(name);
  let document = {};
  if ((0, import_node_fs7.existsSync)(path)) {
    try {
      const parsed = JSON.parse((0, import_node_fs7.readFileSync)(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        document = parsed;
      }
    } catch {
      document = {};
    }
  }
  const entry = { document };
  storeCache.set(name, entry);
  return entry;
}
function saveStoreDocument(name) {
  const entry = loadStoreDocument(name);
  const path = storePath(name);
  const temporary = (0, import_node_path11.join)((0, import_node_path11.dirname)(path), `.${name}.${process.pid}.tmp`);
  (0, import_node_fs7.writeFileSync)(temporary, JSON.stringify(entry.document, null, 2), "utf8");
  (0, import_node_fs7.renameSync)(temporary, path);
}
function modelFetch(url, init) {
  return import_electron2.net.fetch(url, {
    method: "GET",
    headers: init.headers,
    signal: init.signal
  });
}
function registerIpc() {
  const managed = new ManagedCommandRegistry();
  const codexServers = new CodexAppServerRegistry({ send: emitEvent });
  const liveSessionJournal = new LiveSessionJournal({
    rootDirectory: (0, import_node_path11.join)(import_electron2.app.getPath("userData"), "live-session-journal"),
    retentionDays: 30
  });
  let liveSessions;
  const codexTui = createCodexTuiBroker({
    appServer: codexServers,
    executable: "codex",
    viewerHome: prepareCodexTuiViewerHome(import_electron2.app.getPath("userData")),
    emit: emitEvent,
    journal: liveSessionJournal,
    onSessionOutput: async ({ sessionId, bytes }) => {
      await liveSessions.publish({ sessionId, bytes });
    }
  });
  liveSessions = createLiveSessionRuntime({
    broker: codexTui,
    journal: liveSessionJournal
  });
  const handlers = createCommandHandlers({
    host: {
      send: emitEvent,
      updateTray: (state) => {
        trayState = state;
        tray?.setContextMenu(buildTrayMenu());
      },
      showNotification: async (input) => {
        if (!import_electron2.Notification.isSupported()) {
          throw new Error("Native notifications are unavailable on this platform");
        }
        const notification = new import_electron2.Notification({ title: input.title, body: input.body });
        notification.on("click", () => {
          if (input.route) {
            showMainWindow();
            emitEvent("desktop_notification_action", input.route);
          }
        });
        notification.show();
      },
      openExternal: async (url) => {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("External URL is invalid");
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("External URL is not allowed");
        }
        await import_electron2.shell.openExternal(url);
      },
      quitApplication: () => {
        isQuitting = true;
        import_electron2.app.exit(0);
      },
      modelFetch
    },
    managed,
    codexServers,
    codexTui,
    liveSessions
  });
  import_electron2.ipcMain.handle("humanthread:command", async (_event, request) => {
    try {
      const command = typeof request?.command === "string" ? request.command : "";
      const handler = handlers[command];
      if (!handler) {
        return { ok: false, error: `Unknown native command: ${command}` };
      }
      const args = request?.args && typeof request.args === "object" ? request.args : {};
      if (!Number.isSafeInteger(_event.sender.id) || _event.sender.id <= 0) {
        return { ok: false, error: "Desktop window id is invalid" };
      }
      const result = await handler(args, { windowId: _event.sender.id });
      return { ok: true, result: result === void 0 ? null : result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  import_electron2.ipcMain.handle("humanthread:select-directory", async () => {
    const result = await import_electron2.dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "\u9009\u62E9\u9879\u76EE\u76EE\u5F55"
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
  import_electron2.ipcMain.handle("humanthread:store:get", (_event, request) => {
    const name = typeof request?.name === "string" ? request.name : "";
    const key = typeof request?.key === "string" ? request.key : "";
    const entry = loadStoreDocument(name);
    return { found: Object.prototype.hasOwnProperty.call(entry.document, key), value: entry.document[key] };
  });
  import_electron2.ipcMain.handle("humanthread:store:set", (_event, request) => {
    const name = typeof request?.name === "string" ? request.name : "";
    const key = typeof request?.key === "string" ? request.key : "";
    if (key.length === 0 || key.length > 256) {
      throw new Error("Native store key is invalid");
    }
    const entry = loadStoreDocument(name);
    entry.document[key] = request?.value;
    return null;
  });
  import_electron2.ipcMain.handle("humanthread:store:save", (_event, request) => {
    const name = typeof request?.name === "string" ? request.name : "";
    saveStoreDocument(name);
    return null;
  });
  import_electron2.ipcMain.handle("humanthread:open-external", async (_event, request) => {
    const url = typeof request?.url === "string" ? request.url : "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: "External URL is not allowed" };
      }
      await import_electron2.shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  import_electron2.ipcMain.handle("humanthread:deep-link:get-current", () => {
    const urls = pendingDeepLinks;
    pendingDeepLinks = [];
    return urls;
  });
  import_electron2.ipcMain.handle("humanthread:notification:supported", () => import_electron2.Notification.isSupported());
}
function smokeExitMs() {
  const value = Number(process.env.HUMANTHREAD_DESKTOP_SMOKE_MS ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function createWindow() {
  const preloadPath = (0, import_node_path11.join)(__dirname, "preload.cjs");
  const smoke = smokeExitMs() > 0;
  mainWindow = new import_electron2.BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    resizable: true,
    title: "HumanThread Desktop",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (!smoke) mainWindow?.show();
  });
  if (smoke) {
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("[humanthread-smoke] renderer-loaded");
      setTimeout(() => {
        isQuitting = true;
        import_electron2.app.exit(0);
      }, smokeExitMs());
    });
    mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
      console.error(`[humanthread-smoke] renderer-failed ${code} ${description}`);
      isQuitting = true;
      import_electron2.app.exit(1);
    });
  }
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    emitEvent("desktop_window_visibility", false);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingDeepLinks.length > 0) {
      const urls = pendingDeepLinks;
      pendingDeepLinks = [];
      mainWindow?.webContents.send("humanthread:deep-link", urls);
    }
  });
  const devServerUrl = process.env.HUMANTHREAD_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile((0, import_node_path11.join)(__dirname, "..", "dist", "index.html"));
  }
}
function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    import_electron2.app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [(0, import_node_path11.resolve)(process.argv[1])]);
  } else {
    import_electron2.app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }
}
var gotSingleInstanceLock = import_electron2.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  import_electron2.app.quit();
} else {
  import_electron2.app.on("second-instance", (_event, argv) => {
    showMainWindow();
    dispatchDeepLinks(collectDeepLinksFromArgv(argv));
  });
  import_electron2.app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchDeepLinks([url]);
  });
  import_electron2.app.on("activate", () => {
    if (import_electron2.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
  import_electron2.app.on("window-all-closed", () => {
  });
  import_electron2.app.on("before-quit", () => {
    isQuitting = true;
  });
  void import_electron2.app.whenReady().then(() => {
    registerProtocol();
    registerIpc();
    setupTray();
    createWindow();
    dispatchDeepLinks(collectDeepLinksFromArgv(process.argv));
  });
}
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
