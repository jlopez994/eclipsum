# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Revisión con centinela

Centinela (la GitHub App `rufus-centinela`) revisa cada PR de este repo: secretos, código inseguro y dependencias
vulnerables, y Claude comenta en las líneas.

- Los cambios van en una rama, con un PR listo para revisar (`gh pr create`). Un borrador o un push directo a la
  rama principal no pasan por Claude. Si este fichero dice en otro sitio que algo va directo a la rama principal,
  manda eso.
- Tras abrir el PR y tras cada push de correcciones, lanza `gh centinela <número>` (si falta:
  `gh extension install jlopez994/gh-centinela`). Espera a que centinela acabe (1-2 min, hasta 17) y saca su revisión.
- Corrige en el PR lo que Claude marque como crítico o alto. Lo demás, a tu criterio.
- Fusiona solo cuando `gh centinela` salga con 0 en el último commit. Si dice «no ha llegado», no fusiones: avisa a
  quien te lo encargó.
