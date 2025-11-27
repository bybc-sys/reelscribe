const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { promisify } = require('util');
const execPromise = promisify(exec);

// Vercel serverless function
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url || !url.includes('instagram.com')) {
    return res.status(400).json({ error: 'Invalid Instagram URL' });
  }

  const tempDir = '/tmp';
  const tempVideoPath = path.join(tempDir, `video_${Date.now()}.mp4`);
  const tempAudioPath = path.join(tempDir, `audio_${Date.now()}.mp3`);

  try {
    console.log('Step 1: Downloading Instagram reel...');
    
    // Download using yt-dlp
    await execPromise(`yt-dlp -f "best[ext=mp4]" -o "${tempVideoPath}" "${url}"`);

    console.log('Step 2: Extracting audio...');
    
    // Extract audio using ffmpeg
    await execPromise(`ffmpeg -i "${tempVideoPath}" -vn -acodec libmp3lame -ab 128k "${tempAudioPath}"`);

    console.log('Step 3: Transcribing...');
    
    // Transcribe using OpenAI Whisper
    const transcription = await transcribeAudio(tempAudioPath);

    // Clean up
    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);

    return res.status(200).json({ 
      success: true, 
      transcription: transcription 
    });

  } catch (error) {
    console.error('Error:', error);
    
    // Clean up on error
    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);

    return res.status(500).json({ 
      error: 'Failed to transcribe', 
      details: error.message 
    });
  }
};

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
