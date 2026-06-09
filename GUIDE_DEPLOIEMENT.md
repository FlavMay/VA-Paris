# 🚀 Guide de déploiement — Value-Add Paris
## Application en ligne, gratuite, en 30 minutes

---

## Ce que vous allez obtenir
Une application web accessible depuis n'importe quel navigateur, avec une URL du type `valueadd-paris.vercel.app`. Gratuit, sécurisé, accessible à 2 utilisateurs.

---

## ÉTAPE 1 — Créer un compte Supabase (base de données)

1. Allez sur **[supabase.com](https://supabase.com)** → cliquez **Start your project** → créez un compte
2. Cliquez **New project** → choisissez un nom (ex: `valueadd-paris`) → choisissez la région **Europe West** → créez un mot de passe (notez-le) → cliquez **Create new project**
3. Attendez 1-2 minutes que le projet se crée

**Configurer la base de données :**
4. Dans le menu gauche → cliquez **SQL Editor**
5. Copiez-collez TOUT le contenu du fichier `supabase/schema.sql` (fourni dans le dossier)
6. Cliquez **Run** → vous devez voir "Success. No rows returned"

**Récupérer vos clés API :**
7. Dans le menu gauche → **Project Settings** → **API**
8. Notez ces deux valeurs (vous en aurez besoin à l'étape 3) :
   - **Project URL** : ressemble à `https://abcdefgh.supabase.co`
   - **anon public** key : une longue chaîne de caractères

---

## ÉTAPE 2 — Mettre le code sur GitHub

1. Allez sur **[github.com](https://github.com)** → créez un compte gratuit si vous n'en avez pas
2. Cliquez le **+** en haut à droite → **New repository**
3. Nommez-le `valueadd-paris` → laissez tout par défaut → cliquez **Create repository**
4. Sur la page qui s'ouvre, cliquez **uploading an existing file**
5. Glissez-déposez **TOUS les fichiers et dossiers** du dossier `valueadd-paris` (que vous avez téléchargé) dans la zone d'upload
6. Descendez → cliquez **Commit changes**

---

## ÉTAPE 3 — Déployer sur Vercel (hébergement gratuit)

1. Allez sur **[vercel.com](https://vercel.com)** → **Sign up with GitHub**
2. Cliquez **Add New Project** → trouvez `valueadd-paris` dans la liste → cliquez **Import**
3. Dans la section **Environment Variables**, ajoutez ces deux variables :
   - Nom : `VITE_SUPABASE_URL` · Valeur : votre Project URL de l'étape 1
   - Nom : `VITE_SUPABASE_ANON_KEY` · Valeur : votre anon key de l'étape 1
4. Cliquez **Deploy** → attendez 2-3 minutes
5. ✅ Vous obtenez une URL ! Ex : `https://valueadd-paris.vercel.app`

---

## ÉTAPE 4 — Créer vos comptes utilisateurs

1. Ouvrez votre URL dans le navigateur
2. Cliquez **Créer un compte** → entrez votre email + mot de passe
3. Faites de même pour votre associé (chacun créera son propre compte)

**Important :** par défaut, Supabase envoie un email de confirmation. Pour désactiver cela (plus simple) :
- Dans Supabase → **Authentication** → **Email** → désactivez **"Enable email confirmations"**

---

## ÉTAPE 5 — Importer les comparables DVF

1. Allez sur [data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres](https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres)
2. Téléchargez le fichier CSV pour le **département 75 (Paris)**
3. Dans votre application → onglet **📊 Comparables** → importez le fichier
4. Répétez pour d'autres années si souhaité (les doublons sont gérés automatiquement)

---

## Tarifs (tout est gratuit sur les plans de base)

| Service | Plan | Coût | Limite |
|---------|------|------|--------|
| Supabase | Free | **0 €/mois** | 500 MB de données |
| Vercel | Hobby | **0 €/mois** | Déploiements illimités |
| GitHub | Free | **0 €/mois** | Illimité |

500 MB est largement suffisant pour plusieurs années de données DVF Paris + vos biens analysés.

---

## En cas de problème

- Vérifiez que les variables d'environnement sur Vercel sont exactes (pas d'espace en début/fin)
- Le fichier DVF doit être en CSV (séparateur virgule ou point-virgule — les deux sont supportés)
- En cas d'erreur "RLS" lors de l'import DVF : re-exécutez le fichier schema.sql dans Supabase

---

## Mise à jour de l'application

Si vous souhaitez mettre à jour l'application après des modifications :
- Modifiez les fichiers sur GitHub → Vercel redéploie automatiquement en 2 minutes

