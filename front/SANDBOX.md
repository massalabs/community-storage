# Bac à sable

**Convention pour les modifs (IA / humain)**  
- Si la demande commence par **`sb:`** ou **`sb `** → modifier uniquement la partie bac à sable (Sandbox.jsx, SandboxOnly, isSandboxMode()).  
- Sinon → modifier la version réelle (comportement par défaut).

---

En mode **bac à sable**, deux choses changent par rapport à la version réelle :

1. **Données** : tout vient de données fictives (aucun appel au contrat buildnet).
2. **Fonctionnalités** : vous pouvez ajouter des pages, boutons, sections ou logique qui **n’apparaissent qu’en bac à sable** et ne touchent jamais à la version réelle.

## Changer de mode

En dev : dans la barre du site, cliquez sur **Réelles** ou **Bac à sable**. La page se recharge avec le bon mode.

## Ajouter du contenu uniquement en bac à sable

### 1. Page « Expériences » (`/sandbox`)

La page **Expériences** (lien dans la barre, visible seulement en bac à sable) est faite pour ça. Éditez :

- `front/src/pages/Sandbox.jsx`

Ajoutez-y vos blocs, formulaires, tests, etc. Ce contenu ne sera jamais servi en version réelle.

### 2. Afficher un bloc n’importe où (nav, section, bouton)

Enveloppez le contenu dans le composant **SandboxOnly** :

```jsx
import { SandboxOnly } from '../components/SandboxOnly'

// Dans votre JSX :
<SandboxOnly>
  <Link to="/ma-nouvelle-page">Ma page test</Link>
</SandboxOnly>

<SandboxOnly>
  <section>
    <h2>Nouvelle section expérimentale</h2>
    …
  </section>
</SandboxOnly>
```

Tout ce qui est dans `<SandboxOnly>` n’existe qu’en mode bac à sable.

### 3. Brancher de la logique (if sandbox)

Si vous voulez exécuter du code seulement en bac à sable (par ex. autre calcul, autre texte) :

```jsx
import { isSandboxMode } from '../contract/storageRegistryApi'

if (isSandboxMode()) {
  // logique ou UI réservée au bac à sable
}
```

### 4. Nouvelles pages / routes

- Créez une page dans `front/src/pages/` (ex. `MaPageTest.jsx`).
- Ajoutez la route dans `front/src/App.jsx` :  
  `<Route path="/ma-page-test" element={<MaPageTest />} />`
- Ajoutez le lien dans la barre (ou ailleurs) **dans un `<SandboxOnly>`** pour qu’il ne soit visible qu’en bac à sable.

En version réelle, la route existe toujours (si quelqu’un tape l’URL), mais vous pouvez faire afficher un message du type « Cette page n’existe qu’en mode bac à sable » en utilisant `isSandboxMode()` dans la page.

## Récap

| Besoin | Outil |
|--------|--------|
| Données fictives | Mode « Bac à sable » (bouton dans la barre) |
| Cacher un bloc / lien en version réelle | `<SandboxOnly>{…}</SandboxOnly>` |
| Tester une idée sans toucher au reste | Page Expériences (`Sandbox.jsx`) ou nouvelle page + lien dans `SandboxOnly` |
| If (bac à sable) dans le code | `isSandboxMode()` |

En production (build déployé), le sélecteur Réelles / Bac à sable n’apparaît pas et le site reste en données réelles ; tout ce qui est dans `SandboxOnly` ou derrière `isSandboxMode()` est invisible.
