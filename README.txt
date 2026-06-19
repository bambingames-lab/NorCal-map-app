Replace these 3 files in your GitHub repo root:

1. index.html
2. config.js
3. sw.js

Then commit changes.

After GitHub finishes deploying, open:
https://bambingames-lab.github.io/NorCal-map-app/?v=3

This fixes the app staying in local-only mode by:
- adding your Supabase project URL/key to config.js
- forcing config.js to load fresh
- changing the service worker cache to v3
- ensuring config.js loads before bundle.js
