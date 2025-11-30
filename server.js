const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { promisify } = require('util');
const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const tempDir = '/tmp';

app.post('/api/transcribe', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.includes('instagram.com')) {
    return res.status(400).json({ error: 'Invalid Instagram URL' });
  }

  const tempVideoPath = path.join(tempDir, `video_${Date.now()}.mp4`);
  const tempAudioPath = path.join(tempDir, `audio_${Date.now()}.mp3`);

  try {
    console.log('Step 1: Downloading Instagram reel via RapidAPI...');
    
    // Download using RapidAPI Instagram Downloader
    const videoUrl = await downloadInstagramReel(url);
    
    console.log('Step 2: Downloading video file...');
    await downloadFile(videoUrl, tempVideoPath);

    console.log('Step 3: Extracting audio...');
    await execPromise(`ffmpeg -i "${tempVideoPath}" -vn -acodec libmp3lame -ab 128k "${tempAudioPath}"`);

    console.log('Step 4: Transcribing...');
    const transcription = await transcribeAudio(tempAudioPath);

    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);

    res.json({ success: true, transcription });

  } catch (error) {
    console.error('Error:', error);
    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
    res.status(500).json({ error: 'Failed to transcribe', details: error.message });
  }
});

async function downloadInstagramReel(instagramUrl) {
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  
  if (!RAPIDAPI_KEY) {
    throw new Error('RapidAPI key not configured');
  }

  const response = await axios.get('https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert', {
    params: { url: instagramUrl },
    headers: {
      'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
      'x-rapidapi-key': RAPIDAPI_KEY
    }
  });

  // Extract video URL from response
  if (response.data && response.data.media && response.data.media.length > 0) {
    // Get the highest quality video (usually the first one or look for HD)
    const videoData = response.data.media.find(m => m.type === 'video' || m.quality === 'HD') || response.data.media[0];
    
    if (videoData.url) {
      return videoData.url;
    }
    
    // Fallback to thumbnail if video URL not found
    if (videoData.thumbnail) {
      throw new Error('Only thumbnail available, video URL not found');
    }
  }

  throw new Error('Could not extract video URL from Instagram');
}

async function downloadFile(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function transcribeAudio(audioPath) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  if (response.data.segments) {
    return response.data.segments.map(segment => {
      const mins = Math.floor(segment.start / 60);
      const secs = Math.floor(segment.start % 60);
      const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      return `[${timestamp}] ${segment.text.trim()}`;
    }).join('\n\n');
  }

  return response.data.text;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
