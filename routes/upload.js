
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const router = express.Router();
const upload = multer();
const pasta = "teste";
const bucket = "testebucket";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

router.post('/user/:id', upload.single('arquivo'), async (req, res) => {
  const { file } = req;
  const { id } = req.params;

  if (!file) return res.status(400).send('Arquivo não enviado');

  const filename = `${pasta}/${id}_${Date.now()}_${file.originalname.replace(/\s/g, '_')}`;

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

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(filename);



  // Retorna apenas o caminho interno
  res.status(200).json({ url: data.publicUrl });
});

module.exports = router;