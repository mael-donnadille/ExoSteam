const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "", 
  database: "steamrest",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
app.get("/", (req, res) => {
  res.json({ message: "SteamRest API Express OK" });
});

app.get("/jeux", async (req, res) => {
  try {
    const games = await query("SELECT * FROM jeux");

    const formatted = games.map((j) => ({
      jeuId: j.jeu_id,
      titre: j.titre,
      developpeur: j.developpeur,
      editeur: j.editeur,
      dateSortie: j.date_sortie,
      image: j.image,
      prix: Number(j.prix),
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Erreur /jeux :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/utilisateurs", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM utilisateurs");

    const formatted = rows.map((u) => ({
      utilisateurId: u.utilisateur_id,
      nomUtilisateur: u.nom_utilisateur,
      email: u.email,
      dateInscription: u.date_inscription,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Erreur /utilisateurs :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/jeux/:id", async (req, res) => {
  try {
    const idJeu = req.params.id;
    const rows = await query("SELECT * FROM jeux WHERE jeu_id = ?", [idJeu]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Jeu introuvable" });
    }
    const j = rows[0];
    const jeuFormatte = {
      jeuId: j.jeu_id,
      titre: j.titre,
      developpeur: j.developpeur,
      editeur: j.editeur,
      dateSortie: j.date_sortie,
      image: j.image,
      prix: Number(j.prix),
    };
    res.json(jeuFormatte);
  } catch (err) {
    console.error("Erreur GET /jeux/:id :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/utilisateurs/:id/bibliothequejeux", async (req, res) => {
  try {
    const id = req.params.id;
    console.log("GET /utilisateurs/" + id + "/bibliothequejeux");

    const rows = await query(
      "SELECT * FROM bibliotheque_jeux WHERE utilisateur_id = ?",
      [id]
    );

    const mapped = rows.map((row) => ({
      bibliothequeId: row.bibliotheque_id,
      utilisateurId: row.utilisateur_id,
      jeuId: row.jeu_id,
      heuresJeu: row.heures_jeu,
      estInstalle: !!row.est_installe,
    }));

    res.json(mapped);
  } catch (err) {
    console.error("Erreur GET /utilisateurs/:id/bibliothequejeux :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


app.post("/achats", async (req, res) => {
  const { jeuId, utilisateurId } = req.body;

  if (!jeuId || !utilisateurId) {
    return res
      .status(400)
      .json({ error: "jeuId et utilisateurId sont requis" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      "INSERT INTO achats (utilisateur_id, jeu_id, date_achat) VALUES (?, ?, NOW())",
      [utilisateurId, jeuId]
    );

    const achatId = result.insertId;

    const [existing] = await conn.query(
      "SELECT * FROM bibliotheque_jeux WHERE utilisateur_id = ? AND jeu_id = ?",
      [utilisateurId, jeuId]
    );

    if (existing.length === 0) {
      await conn.query(
        "INSERT INTO bibliotheque_jeux (utilisateur_id, jeu_id, heures_jeu, est_installe) VALUES (?, ?, 0, 0)",
        [utilisateurId, jeuId]
      );
    }

    await conn.commit();

    const [createdRows] = await conn.query(
      "SELECT * FROM achats WHERE achat_id = ?",
      [achatId]
    );
    const achat = createdRows[0];

    res.status(201).json({
      achatId: achat.achat_id,
      utilisateurId: achat.utilisateur_id,
      jeuId: achat.jeu_id,
      dateAchat: achat.date_achat,
    });
  } catch (err) {
    await conn.rollback();
    console.error("Erreur POST /achats :", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    conn.release();
  }
});

app.put(
  "/utilisateurs/:utilisateurId/bibliothequejeux/:jeuId",
  async (req, res) => {
    const utilisateurId = Number(req.params.utilisateurId);
    const jeuId = Number(req.params.jeuId);
    const { estInstalle } = req.body;

    if (Number.isNaN(utilisateurId) || Number.isNaN(jeuId)) {
      return res.status(400).json({ error: "IDs invalides" });
    }

    try {
      await query(
        "UPDATE bibliotheque_jeux SET est_installe = ? WHERE utilisateur_id = ? AND jeu_id = ?",
        [estInstalle ? 1 : 0, utilisateurId, jeuId]
      );

      const rows = await query(
        "SELECT * FROM bibliotheque_jeux WHERE utilisateur_id = ? AND jeu_id = ?",
        [utilisateurId, jeuId]
      );

      if (rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Jeu non trouvé dans la bibliothèque" });
      }

      const b = rows[0];
      res.json({
        bibliothequeId: b.bibliotheque_id,
        utilisateurId: b.utilisateur_id,
        jeuId: b.jeu_id,
        heuresJeu: b.heures_jeu,
        estInstalle: Boolean(b.est_installe),
      });
    } catch (err) {
      console.error("Erreur PUT bibliotheque :", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

app.delete(
  "/utilisateurs/:utilisateurId/bibliothequejeux/:jeuId",
  async (req, res) => {
    const utilisateurId = Number(req.params.utilisateurId);
    const jeuId = Number(req.params.jeuId);

    if (Number.isNaN(utilisateurId) || Number.isNaN(jeuId)) {
      return res.status(400).json({ error: "IDs invalides" });
    }

    try {
      const rows = await query(
        "SELECT * FROM bibliotheque_jeux WHERE utilisateur_id = ? AND jeu_id = ?",
        [utilisateurId, jeuId]
      );

      if (rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Jeu non trouvé dans la bibliothèque" });
      }

      await query(
        "DELETE FROM bibliotheque_jeux WHERE utilisateur_id = ? AND jeu_id = ?",
        [utilisateurId, jeuId]
      );

      const b = rows[0];
      res.json({
        bibliothequeId: b.bibliotheque_id,
        utilisateurId: b.utilisateur_id,
        jeuId: b.jeu_id,
        heuresJeu: b.heures_jeu,
        estInstalle: Boolean(b.est_installe),
      });
    } catch (err) {
      console.error("Erreur DELETE bibliotheque :", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

app.listen(PORT, () => {
  console.log(`API SteamRest Express démarrée sur http://localhost:${PORT}`);
});
