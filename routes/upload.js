const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
const upload = multer();
const pastaFotoPerfil = "fotos_de_perfil";
const pastaMedia = "media";
const bucket = "bucket_arquivos_medias";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🔹 Função para sanitizar nomes de arquivos
const sanitizeFilename = (originalName) => {
  return originalName
    .normalize('NFD')                  // separa caracteres acentuados
    .replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/[^\w.-]/g, '_');        // substitui caracteres inválidos por _
};

// 📁 Upload de foto de perfil do usuário
router.post('/user/:id', authMiddleware, upload.single('arquivo'), async (req, res) => {
  const { file } = req;
  const { id } = req.params;

  if (!file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const user_id = req.userId;

  // Apenas o próprio usuário ou admin podem enviar
  if (user_id !== id) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const filename = `${pastaFotoPerfil}/${id}_${Date.now()}_${sanitizeFilename(file.originalname)}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    console.error('Supabase Upload Error:', uploadError);
    return res.status(500).json({ error: uploadError.message });
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);

  res.status(200).json({ url: data.publicUrl });
});

// 📁 Upload de mídia geral (associar ao usuário que enviou)
router.post('/media', authMiddleware, upload.single('arquivo'), async (req, res) => {
  const { file } = req;
  if (!file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const userId = req.userId; // quem está enviando
  const filename = `${pastaMedia}/${userId}_${Date.now()}_${sanitizeFilename(file.originalname)}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    console.error('Supabase Upload Error:', uploadError);
    return res.status(500).json({ error: uploadError.message });
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);

  res.status(200).json({ url: data.publicUrl });
});

module.exports = router;
