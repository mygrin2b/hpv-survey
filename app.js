const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises; // Use promises for async file operations
const path = require('path');
const QRCode = require('qrcode');
const basicAuth = require('express-basic-auth');
const { DateTime } = require('luxon'); // For reliable time zone handling
const simpleGit = require('simple-git'); // For Git operations
const app = express();
const port = process.env.PORT || 3000; // Use PORT env for Render compatibility

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

// Basic auth configuration
const auth = basicAuth({
  users: { 'admin': 'survey2025' }, // Username: admin, Password: survey2025
  challenge: true,
  unauthorizedResponse: 'Unauthorized: Please enter the correct username and password'
});

// Get current date (Hong Kong time, UTC+8) in YYYY-MM-DD format
function getDateString() {
  return DateTime.now().setZone('Asia/Hong_Kong').toFormat('yyyy-MM-dd');
}

// Initialize Git
const git = simpleGit();
const githubConfig = {
  repoUrl: process.env.GITHUB_REPO_URL, // e.g., https://github.com/your-username/your-repo.git
  username: process.env.GITHUB_USERNAME,
  email: process.env.GITHUB_EMAIL,
  token: process.env.GITHUB_TOKEN
};

// Configure Git with user credentials
async function configureGit() {
  try {
    await git.addConfig('user.name', githubConfig.username);
    await git.addConfig('user.email', githubConfig.email);
    // Add token to repo URL for authentication
    const authRepoUrl = githubConfig.repoUrl.replace('https://', `https://${githubConfig.token}@`);
    await git.addRemote('origin', authRepoUrl, { '--force': null });
    console.log('Git configured successfully');
  } catch (err) {
    console.error('Failed to configure Git:', err);
  }
}

// Push logs to GitHub
async function pushToGitHub(logFileName) {
  try {
    await git.add(`./${logFileName}`);
    await git.commit(`Update survey log: ${logFileName}`);
    await git.push('origin', 'main', { '--force': null }); // Adjust branch name if not 'main'
    console.log(`Successfully pushed ${logFileName} to GitHub`);
  } catch (err) {
    console.error('Failed to push to GitHub:', err);
  }
}

// Initialize Git at startup
configureGit();

// Generate QR code at server startup
const surveyUrl = process.env.SURVEY_URL || 'http://localhost:3000/info-sheet'; // Use env for Render
const qrCodePath = path.join(__dirname, 'public', 'images', 'qr-code.png');

// Ensure images directory exists
const imagesDir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Generate and save QR code
QRCode.toFile(qrCodePath, surveyUrl, {
  color: {
    dark: '#000000',
    light: '#FFFFFF'
  }
}, (err) => {
  if (err) {
    console.error('Failed to generate QR code:', err);
  } else {
    console.log(`QR code generated and saved to ${qrCodePath}`);
  }
});

// Routes
// Homepage (redirects to info-sheet)
app.get('/', (req, res) => {
  res.redirect('/info-sheet');
});

// Download links page
app.get('/downloads', async (req, res) => {
  try {
    const logFiles = (await fs.readdir(__dirname))
      .filter(file => file.startsWith('log-') && file.endsWith('.txt'))
      .map(file => file.replace('log-', '').replace('.txt', ''));
    res.render('index', { logFiles });
  } catch (err) {
    console.error('Failed to read log files:', err);
    res.status(500).send('Error loading downloads page');
  }
});

// Information Sheet page
app.get('/info-sheet', (req, res) => {
  res.render('info-sheet');
});

// Goodbye page
app.get('/goodbye', (req, res) => {
  res.render('goodbye');
});

// Survey page
app.get('/survey', (req, res) => {
  res.render('survey');
});

// Download CSV file (requires auth)
app.get('/download/:date', auth, async (req, res) => {
  try {
    const date = req.params.date;
    const logFile = `log-${date}.txt`;
    const logFilePath = path.join(__dirname, logFile);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).send('Log file not found for the specified date');
    }

    const fileContent = await fs.readFile(logFilePath, 'utf8');
    const responses = fileContent
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line));

    if (responses.length === 0) {
      return res.status(404).send('Log file for the specified date is empty');
    }

    const headers = ['timestamp', ...Object.keys(responses[0]).filter(key => key !== 'timestamp')];
    const csvRows = [headers.join(',')];

    responses.forEach(response => {
      const row = headers.map(header => {
        let value = response[header] || '';
        if (typeof value === 'string') {
          // Prevent CSV injection by escaping formula characters
          if (value.match(/^[=+\-@]/)) {
            value = `'${value}`;
          }
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
      csvRows.push(row);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=responses-${date}.csv`);
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('Failed to generate CSV file:', err);
    res.status(500).send('Error generating CSV file');
  }
});

// Handle survey submission
app.post('/survey', async (req, res) => {
  try {
    // Required fields from survey.ejs
    const requiredFields = [
      'age', 'gender', 'studies', 'status', 'familyCancer', 'friendsVaccine', 'residential',
      'hpvVirus', 'hpvNoSymptoms', 'hpvCancer', 'hpvAge', 'hpvPrevention',
      'hpvBlood', 'hpvRespiratory', 'hpvSexual', 'hpvWomenOnly', 'hpvCure', 'hpvVaccineExists', 'hpvTest',
      'hpvLongTerm', 'hpvGovPromotion', 'hpvAdvertising', 'hpvTreatInfection', 'hpvCompulsory',
      'reasonWorkplace', 'reasonIncentives', 'reasonMedical', 'reasonFamilyFriends', 'reasonProtect',
      'reasonLowRisk', 'reasonAge', 'reasonSideEffects', 'reasonNotCompulsory', 'reasonCost', 'reasonNoKnowledge', 'reasonFamilyOpposition', 'reasonSafety',
      'fluVaccine', 'covidVaccine', 'hepatitisVaccine',
      'hpvSideEffects', 'hpvLessProtective', 'hpvExpensive', 'hpvLessDangerous', 'hpvLackInfo'
    ];

    // Check for missing required fields
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).send(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Sanitize input to prevent CSV injection
    const response = {
      timestamp: new Date().toISOString(),
      ...req.body
    };

    Object.keys(response).forEach(key => {
      if (typeof response[key] === 'string') {
        response[key] = response[key].replace(/"/g, '""').replace(/,/g, '\\,');
      }
    });

    const dateString = getDateString();
    const logFileName = `log-${dateString}.txt`;
    const logFilePath = path.join(__dirname, logFileName);
    const responseString = JSON.stringify(response) + '\n';

    await fs.appendFile(logFilePath, responseString, 'utf8');
    console.log(`Survey response saved to ${logFileName}:`, response);

    // Push to GitHub after saving log
    await pushToGitHub(logFileName);

    res.redirect('/thank-you');
  } catch (err) {
    console.error('Failed to save survey response:', err);
    res.status(500).send('Error submitting survey');
  }
});

// Thank-you page
app.get('/thank-you', (req, res) => {
  res.render('thank-you');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong. Please try again later.');
});

// Start server
app.listen(port, () => {
  console.log(`Server running at ${surveyUrl}`);
});
