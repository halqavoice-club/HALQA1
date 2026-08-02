const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

// ─── Detect email provider from SMTP_HOST ────────────────────────────────────
function getTransporter() {
  if (transporter) return transporter;

  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s/g, ''); // Gmail app passwords have spaces
  const port = parseInt(process.env.SMTP_PORT || '587');

  // Gmail shortcut — auto-configure
  if (host.includes('gmail') || user.includes('gmail')) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
    return transporter;
  }

  // Outlook/Hotmail shortcut
  if (host.includes('outlook') || host.includes('hotmail') || user.includes('outlook') || user.includes('hotmail')) {
    transporter = nodemailer.createTransport({
      service: 'hotmail',
      auth: { user, pass }
    });
    return transporter;
  }

  // Generic SMTP
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false } // allow self-signed certs
  });
  return transporter;
}

// ─── Check if email is configured ────────────────────────────────────────────
function isEmailConfigured() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s/g, ''); // remove spaces from app password
  return !!(
    user &&
    pass &&
    user !== 'your@email.com' &&
    user !== 'your@gmail.com' &&
    pass !== 'your_app_password' &&
    pass !== 'your-app-password' &&
    pass.length >= 8
  );
}

// ─── Core send function ───────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    logger.warn(`📧 Email skipped (not configured): "${subject}" → ${to}`);
    logger.warn('   To enable email: set SMTP_USER and SMTP_PASS in backend/.env');
    return { success: false, error: 'SMTP not configured', skipped: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `Halqa System <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, '') || subject
    });
    logger.info(`✅ Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    // Provide helpful error messages for common Gmail issues
    let hint = '';
    if (error.message?.includes('535') || error.message?.includes('BadCredentials')) {
      hint = ' | Gmail fix: Go to myaccount.google.com/apppasswords → create new App Password → update SMTP_PASS in .env';
      // Reset transporter so next attempt uses fresh credentials
      transporter = null;
    } else if (error.message?.includes('534') || error.message?.includes('less secure')) {
      hint = ' | Enable 2FA and use App Password instead of regular password';
    }
    logger.error(`❌ Email failed to ${to}: ${error.message}${hint}`);
    // Don't throw — email failure should never crash the app
    return { success: false, error: error.message };
  }
}

// ─── OTP Email ────────────────────────────────────────────────────────────────
async function sendOtpEmail(email, otp, type = 'email_verify') {
  const subjects = {
    email_verify: 'Verify Your Email - Halqa Management System',
    password_reset: 'Password Reset Code - Halqa Management System',
    login_otp: 'Login Verification Code - Halqa Management System'
  };

  const typeLabels = {
    email_verify: 'email verification',
    password_reset: 'password reset',
    login_otp: 'login verification'
  };

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:500px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:30px;text-align:center">
      <h1 style="color:white;margin:0;font-size:22px">🕌 Halqa Management System</h1>
    </div>
    <div style="padding:30px">
      <h2 style="color:#1e293b;margin-top:0">Your ${typeLabels[type] || 'verification'} code</h2>
      <p style="color:#64748b">Use the code below to complete your request. It expires in <strong>${process.env.OTP_EXPIRY_MINUTES || 10} minutes</strong>.</p>
      <div style="background:#eff6ff;border:2px dashed #3b82f6;border-radius:10px;padding:24px;text-align:center;margin:24px 0">
        <div style="font-size:40px;font-weight:bold;color:#1e40af;letter-spacing:10px;font-family:monospace">${otp}</div>
      </div>
      <p style="color:#94a3b8;font-size:13px">If you did not request this, please ignore this email. Do not share this code with anyone.</p>
    </div>
    <div style="background:#f8fafc;padding:16px;text-align:center;color:#94a3b8;font-size:12px">
      © ${new Date().getFullYear()} Halqa Management System · All rights reserved
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: email, subject: subjects[type] || 'Verification Code - Halqa', html });
}

// ─── Attendance Alert ─────────────────────────────────────────────────────────
async function sendAttendanceAlert(email, studentName, status, date) {
  const statusColor = status === 'ABSENT' ? '#dc2626' : status === 'LATE' ? '#d97706' : '#16a34a';
  const statusEmoji = status === 'ABSENT' ? '❌' : status === 'LATE' ? '⏰' : '✅';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:500px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
    <div style="background:#1e3a5f;padding:20px;text-align:center">
      <h2 style="color:white;margin:0">${statusEmoji} Attendance Alert</h2>
    </div>
    <div style="padding:24px">
      <p style="color:#374151">Dear Parent/Guardian,</p>
      <p style="color:#374151">This is to inform you that <strong>${studentName}</strong> was marked as
        <strong style="color:${statusColor}">${status}</strong>
        on <strong>${new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
      </p>
      <div style="background:#f8fafc;border-left:4px solid ${statusColor};padding:12px 16px;border-radius:4px;margin:16px 0">
        <p style="margin:0;color:#374151;font-size:14px">
          If you have any questions or concerns, please contact the school directly.
        </p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px;text-align:center;color:#94a3b8;font-size:12px">
      © ${new Date().getFullYear()} Halqa Management System
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: email, subject: `${statusEmoji} Attendance: ${studentName} — ${status}`, html });
}

// ─── Grade notification ───────────────────────────────────────────────────────
async function sendGradeNotification(email, studentName, title, score, maxScore, letterGrade) {
  const pct = Math.round((score / maxScore) * 100);
  const color = pct >= 90 ? '#16a34a' : pct >= 70 ? '#2563eb' : pct >= 60 ? '#d97706' : '#dc2626';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:500px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
    <div style="background:#1e3a5f;padding:20px;text-align:center">
      <h2 style="color:white;margin:0">📊 New Grade Posted</h2>
    </div>
    <div style="padding:24px">
      <p style="color:#374151">A new grade has been posted for <strong>${studentName}</strong>:</p>
      <div style="background:#f8fafc;border-radius:10px;padding:20px;text-align:center;margin:16px 0">
        <p style="margin:0 0 8px;color:#64748b;font-size:14px">${title}</p>
        <div style="font-size:48px;font-weight:bold;color:${color}">${letterGrade}</div>
        <p style="margin:8px 0 0;color:#64748b">${score}/${maxScore} (${pct}%)</p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px;text-align:center;color:#94a3b8;font-size:12px">
      © ${new Date().getFullYear()} Halqa Management System
    </div>
  </div>
</body>
</html>`;

  return sendEmail({ to: email, subject: `📊 New Grade: ${studentName} — ${title} (${letterGrade})`, html });
}

// ─── Test email connection ────────────────────────────────────────────────────
async function testEmailConnection() {
  if (!isEmailConfigured()) {
    return { success: false, message: 'SMTP not configured. Set SMTP_USER and SMTP_PASS in .env' };
  }
  try {
    await getTransporter().verify();
    return { success: true, message: 'Email connection verified successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

module.exports = { sendEmail, sendOtpEmail, sendAttendanceAlert, sendGradeNotification, testEmailConnection, isEmailConfigured };
