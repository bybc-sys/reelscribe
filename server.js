// Force redeploy with RAPIDAPI_KEY - v3
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
    console.log('Video URL obtained:', videoUrl);
    
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

  console.log('Making request to RapidAPI...');
  
  try {
    const response = await axios.get('https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert', {
      params: { url: instagramUrl },
      headers: {
        'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    console.log('RapidAPI response:', JSON.stringify(response.data, null, 2));

    // Handle different possible response structures
    if (response.data) {
      // Try different possible response formats
      
      // Format 1: Direct URL
      if (typeof response.data === 'string' && response.data.startsWith('http')) {
        return response.data;
      }
      
      // Format 2: data.url
      if (response.data.url) {
        return response.data.url;
      }
      
      // Format 3: data.video_url
      if (response.data.video_url) {
        return response.data.video_url;
      }
      
      // Format 4: data.download_url
      if (response.data.download_url) {
        return response.data.download_url;
      }
      
      // Format 5: data.media array
      if (response.data.media && Array.isArray(response.data.media) && response.data.media.length > 0) {
        const videoData = response.data.media.find(m => m.type === 'video' || m.quality === 'HD') || response.data.media[0];
        
        if (videoData.url) {
          return videoData.url;
        }
        
        if (videoData.video_url) {
          return videoData.video_url;
        }
        
        if (videoData.download_url) {
          return videoData.download_url;
        }
      }
      
      // Format 6: data.result
      if (response.data.result) {
        if (typeof response.data.result === 'string' && response.data.result.startsWith('http')) {
          return response.data.result;
        }
        
        if (response.data.result.url) {
          return response.data.result.url;
        }
        
        if (response.data.result.video_url) {
          return response.data.result.video_url;
        }
      }
      
      // Format 7: data.data
      if (response.data.data) {
        if (response.data.data.url) {
          return response.data.data.url;
        }
        
        if (response.data.data.video_url) {
          return response.data.data.video_url;
        }
      }
    }

    // If we couldn't find the URL, log the response and throw an error
    throw new Error(`Could not extract video URL from response. Response structure: ${JSON.stringify(Object.keys(response.data))}`);
    
  } catch (error) {
    if (error.response) {
      console.error('RapidAPI Error Response:', error.response.data);
      throw new Error(`RapidAPI Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function downloadFile(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 30000 // 30 second timeout
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
  console.log(`Environment check - RAPIDAPI_KEY: ${process.env.RAPIDAPI_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`Environment check - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
});
