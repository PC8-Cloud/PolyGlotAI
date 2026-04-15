# Firestore Entitlements Schema

Questo progetto ora legge gli accessi premium da `users/{uid}` con priorità su `entitlements`.

## Documento consigliato

```json
{
  "entitlements": {
    "plan": "tourist_weekly",
    "status": "active",
    "expiresAt": "2026-04-10T12:00:00.000Z"
  }
}
```

Campi supportati:
- `entitlements.plan`: `free | tourist_weekly | tourist | pro | business`
- `entitlements.status`: `active | grace | past_due | canceled | inactive`
- `entitlements.expiresAt`: ISO string, Firestore Timestamp, Date o epoch

## Compatibilità legacy

Se `entitlements` non esiste, il client usa fallback:
- `plan`
- `planExpiresAt`
- `planStatus` (opzionale)

## Priorità logica lato client

1. `users/{uid}.entitlements.*`
2. fallback legacy `plan/planExpiresAt/planStatus`
3. default `free`

## Webhook Stripe (raccomandato)

Al `checkout.session.completed` / `invoice.paid` aggiorna `users/{uid}`:

```json
{
  "entitlements": {
    "plan": "pro",
    "status": "active",
    "expiresAt": "..."
  }
}
```

Al mancato pagamento/cancellazione:

```json
{
  "entitlements": {
    "plan": "pro",
    "status": "past_due",
    "expiresAt": "..."
  }
}
```

Quando il periodo termina e non c'è rinnovo:

```json
{
  "entitlements": {
    "plan": "free",
    "status": "inactive",
    "expiresAt": null
  }
}
```

