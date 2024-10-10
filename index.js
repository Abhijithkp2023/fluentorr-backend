import { createHash } from 'crypto';
import FormData from 'form-data';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { PassThrough } from 'stream';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';


const corsConfig = {
  origin: "*",
  credential: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type", "Request-Index"],
}

dotenv.config();

const app = express();
const port = 80;

const appKey = process.env.APP_KEY;
const secretKey = process.env.SECRET_KEY;
const userId = "uid";
const baseHOST = "api.speechsuper.com";
app.options('*',cors(corsConfig))
app.use(cors(corsConfig));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Set up multer to handle file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Set the ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, 'dist')));


app.post('/api/analyze', upload.single('file'), async (req, res) => {
  const audioBuffer = req.file.buffer;
  const refText = req.body.refText;

  const audioType = "wav";
  const audioSampleRate = "16000";
  const requestParams = {
    scale: 100,
    accent_dialect: "indian",
    coreType: "sent.eval.promax",
    refText: refText,
  };

  try {
    const outputBuffer = await convertToWav(audioBuffer);
    const analysisResult = await doEval(userId, audioType, audioSampleRate, requestParams, outputBuffer);
    res.json(JSON.parse(analysisResult));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analyze-description', upload.single('file'), async (req, res) => {
  const audioBuffer = req.file.buffer;
  const audioType = "wav";
  const audioSampleRate = "16000";
  const requestParams = {
    coreType: "speak.eval.pro",
    test_type: "ielts",
    task_type: "ielts_part1",
    question_prompt: "Describe the picture.",
    model: "non_native",
    penalize_offtopic: 1,
  };

  try {
    const outputBuffer = await convertToWav(audioBuffer);
    const analysisResult = await doEval(userId, audioType, audioSampleRate, requestParams, outputBuffer);
    res.json(JSON.parse(analysisResult));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function convertToWav(inputBuffer) {
  return new Promise((resolve, reject) => {
    const inputStream = new PassThrough();
    const outputStream = new PassThrough();
    const chunks = [];
    inputStream.end(inputBuffer);

    outputStream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    outputStream.on('error', reject);
    ffmpeg(inputStream)
      .outputOptions([
        '-ar 16000',
        '-ac 1',
        '-b:a 96k',
        '-sample_fmt s16'
      ])
      .format('wav')
      .on('error', (err) => {
        reject(err);
      })
      .pipe(outputStream, { end: true });
  });
}

async function doEval(userId, audioType, sampleRate, requestParams, audioBuffer) {
  const coreType = requestParams['coreType'];
  let encrypt = function(content) {
    let hash = createHash("sha1");
    hash.update(content);
    return hash.digest('hex');
  };
  let getConnectSig = function() {
    var timestamp = new Date().getTime().toString();
    var sig = encrypt(appKey + timestamp + secretKey);
    return { sig: sig, timestamp: timestamp };
  };
  let getStartSig = function() {
    var timestamp = new Date().getTime().toString();
    var sig = encrypt(appKey + timestamp + userId + secretKey);
    return { sig: sig, timestamp: timestamp, userId: userId };
  };
  let createUUID = (function(uuidRegEx, uuidReplacer) {
    return function() {
      return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(uuidRegEx, uuidReplacer).toUpperCase();
    };
  })(/[xy]/g, function(c) {
    let r = Math.random() * 16 | 0,
        v = c == "x" ? r : (r & 3 | 8);
    return v.toString(16);
  });
  let connectSig = getConnectSig();
  let startSig = getStartSig();
  requestParams['tokenId'] = requestParams['tokenId'] || createUUID();

  let params = {
    connect: {
      cmd: "connect",
      param: {
        sdk: {
          version: 16777472,
          source: 9,
          protocol: 2
        },
        app: {
          applicationId: appKey,
          sig: connectSig.sig,
          timestamp: connectSig.timestamp
        }
      }
    },
    
    start: {
      cmd: "start",
      param: {
        app: {
          applicationId: appKey,
          sig: startSig.sig,
          userId: startSig.userId,
          timestamp: startSig.timestamp
        },
        audio: {
          audioType,
          sampleRate,
          channel: 1,
          sampleBytes: 2
        },
        request: requestParams
      }
    }
  };
  return new Promise((resolve, reject) => {
    let fd = new FormData();
    fd.append("text", JSON.stringify(params));
    fd.append("audio", audioBuffer, { filename: 'audio.wav' });

    const options = {
      host: baseHOST,
      path: "/" + coreType,
      method: "POST",
      protocol: "https:",
      headers: { "Request-Index": "0" }
    };

    try {
      const req = fd.submit(options, (err, res) => {
        if (err) {
          console.error('Request submission error:', err.message);
          return reject(new Error(err.message));
        }
        if (res.statusCode < 200 || res.statusCode > 299) {
          return reject(new Error(`HTTP status code ${res.statusCode}`));
        }
        const body = [];
        res.on('data', (chunk) => body.push(chunk));
        res.on('end', () => {
          const resString = Buffer.concat(body).toString();
          resolve(resString);
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

app.listen(port,'0.0.0.0', () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
