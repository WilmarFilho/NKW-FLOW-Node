const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Envia e-mail de texto simples
 * @param {string} to - destinatário
 * @param {string} subject - assunto
 * @param {string} text - corpo do e-mail
 */
async function sendEmail(to, subject, text) {
  try {
    const msg = {
      to,
      from: process.env.SENDGRID_FROM, // e-mail verificado no SendGrid
      subject,
      text,
    };
    await sgMail.send(msg);
  } catch (err) {
    console.error('❌ Erro ao enviar e-mail:', err.response?.body || err.message);
  }
}

module.exports = { sendEmail };