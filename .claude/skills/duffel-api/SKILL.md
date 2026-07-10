# Duffel API Skill - Flight Search

Written from live Duffel documentation. Do not edit from memory or training data -
re-fetch docs if anything here looks stale.

## Doc URLs used
- https://duffel.com/docs (structure overview)
- https://duffel.com/docs/api/overview/making-requests (auth, headers)
- https://duffel.com/docs/api/overview/test-mode (sandbox vs live)
- https://duffel.com/docs/api/overview/errors (error shape, rate limits)
- https://duffel.com/docs/api/overview/pagination (cursor pagination)
- https://duffel.com/docs/api/offer-requests (offer request overview + endpoints)
- https://duffel.com/docs/api/offer-requests/create-offer-request (request/response shape)
- https://duffel.com/docs/api/offers (offer object full schema)
- https://duffel.com/docs/api/orders (order object overview - for model understanding only)

---

## Authentication

**Method:** Bearer token in the `Authorization` header.

```
Authorization: Bearer <YOUR_ACCESS_TOKEN>
```

Tokens are created in the Duffel dashboard and can be read-only or read-write.

**Required headers on every request:**
```
Authorization: Bearer <token>
Duffel-Version: v2
Accept: application/json
Content-Type: application/json   # POST/PUT only
Accept-Encoding: gzip            # recommended
```

**Optional headers:**
```
x-client-correlation-id: <your-id>         # custom request tracing
x-duffel-device-ip: <ip>                   # fraud detection (booking endpoints)
x-duffel-device-user-agent: <ua-string>    # fraud detection (booking endpoints)
```

---

## Sandbox vs Live

**Single base URL for both environments:**
```
https://api.duffel.com
```

There is NO separate sandbox base URL. The environment is determined entirely by the token:

| Token prefix   | Environment | Notes                              |
|----------------|-------------|------------------------------------|
| `duffel_test_` | Sandbox     | Use for all development work       |
| (other)        | Live        | Real money - never touch in code   |

The response field `live_mode: boolean` confirms which environment a request ran in.

**Sandbox airline:** Duffel Airways, IATA code `ZZ`. Use this for reliable test searches
- real airline sandboxes can have maintenance windows or depleted inventory.
Trade-off: ZZ prices and schedules are not realistic.

**Guardrail reference:** CLAUDE.md guardrail #1 - never call a live endpoint. Hardcode
the sandbox check: reject any token that does not start with `duffel_test_`.

---

## Object Model: Search → Offer → Order

```
OfferRequest  (your search parameters)
    └─► Offer[]  (airline responses - one per itinerary option)
            └─► Order  (confirmed booking - LIVE: see src/lib/duffel/orders.ts,
                        POST /api/booking. Order creation and payment are
                        both built and in production, not future scope.)
```

### OfferRequest
Represents a flight search. Contains slices (routes), passengers, and cabin class.
The API returns a list of Offers in the same response when `return_offers=true` (default).

Key fields:
```
id:           "orq_00009hjdomFOCJyxHG7k7k"
live_mode:    false   // always false in sandbox
passengers:   Passenger[]
slices:       Slice[]   // the searched route(s)
cabin_class:  "economy" | "premium_economy" | "business" | "first" | null
offers:       Offer[]   // populated when return_offers=true
client_key:   string    // for Duffel Ancillaries UI component
```

### Offer
One bookable itinerary option returned by an airline. Multiple offers per search.

Key fields:
```
id:                  "off_00009htYpSCXrwaB9DnUm0"
expires_at:          ISO 8601  // offers expire - check before booking
live_mode:           boolean
total_amount:        "45.00"   // string, not number
total_currency:      "GBP"     // ISO 4217
base_amount:         "30.20"
base_currency:       "GBP"
tax_amount:          "40.80" | null
tax_currency:        "GBP" | null
total_emissions_kg:  "460" | null
owner:               Airline   // the airline selling this offer
slices:              OfferSlice[]
passengers:          OfferPassenger[]
conditions:          Conditions
payment_requirements: object
available_services:  Service[]  // bags, seats, etc.
partial:             boolean
```

### OfferSlice
One leg of the journey (e.g., LHR→JFK on a return trip is one slice).
```
id:              "sli_..."
origin:          Airport
destination:     Airport
duration:        "PT02H26M"   // ISO 8601 duration
fare_brand_name: "Basic"
conditions:      object
segments:        Segment[]
```

### Segment
One flight within a slice (slices can have connections = multiple segments).
```
id:                             "seg_..."
departing_at:                   "2024-06-01T08:00:00"  // ISO 8601, no tz = local airport time
arriving_at:                    "2024-06-01T10:26:00"
duration:                       "PT02H26M"
origin:                         Airport
origin_terminal:                "B"
destination:                    Airport
destination_terminal:           "5"
distance:                       "424.2"
marketing_carrier:              Airline   // the airline on the ticket
marketing_carrier_flight_number: "1234"
operating_carrier:              Airline   // the airline actually flying
operating_carrier_flight_number: "4321"
aircraft:                       { id, name, iata_code }
passengers:                     SegmentPassenger[]
stops:                          Stop[]    // en-route stops (not connections)
```

> **Regulatory requirement (from docs):** "When presenting offers to your customers,
> you should always show the full name of the operating carrier of each segment
> prominently on the first screen where the offer is presented." (US regulation)

### Airport
```
iata_code:        "LHR"
icao_code:        "EGLL"
name:             "Heathrow"
city_name:        "London"
iata_city_code:   "LON"
iata_country_code:"GB"
time_zone:        "Europe/London"
latitude:         51.47
longitude:       -0.45
```

### Airline
```
id:         "arl_00001876aqC8c5umZmrRds"
iata_code:  "BA"
name:       "British Airways"
logo_symbol_url: "https://..."  // SVG
logo_lockup_url: "https://..."  // SVG
```

### Conditions (on offer and per-slice)
```
refund_before_departure:  { allowed: boolean, penalty_amount: string, penalty_currency: string }
change_before_departure:  { allowed: boolean, penalty_amount: string, penalty_currency: string }
priority_boarding:        string
priority_check_in:        string
advance_seat_selection:   string
```

### Order (LIVE - see src/lib/duffel/orders.ts)
Created from an offer. Contains `booking_reference` (PNR), `payment_status`, and the
confirmed itinerary. Created via `POST /air/orders`, called from `POST /api/booking`
after a real Stripe payment succeeds and is re-verified against the offer's own price.

---

## Search Flow

```
1. POST /air/offer_requests   → returns offer_request.id + offers[]
2. (optional) GET /air/offers/{id}   → get a single offer by id
3. (optional) GET /air/offer_requests/{id}  → re-fetch all offers for a search
4. POST /air/orders            → creates the confirmed booking (LIVE, see
                                   src/lib/duffel/orders.ts and POST /api/booking)
```

---

## Create Offer Request

**Endpoint:** `POST https://api.duffel.com/air/offer_requests`

**Query parameters:**
| Param             | Type    | Default | Notes                              |
|-------------------|---------|---------|------------------------------------|
| `return_offers`   | boolean | `true`  | Include offers in response         |
| `supplier_timeout`| integer | `20000` | ms, range 2000–60000              |
| `view`            | enum    | `"offers"` | `"offers"` or `"itineraries"` |

**Request body:**
```json
{
  "data": {
    "slices": [
      {
        "origin": "LHR",
        "destination": "JFK",
        "departure_date": "2024-12-01",
        "departure_time": { "from": "06:00", "to": "12:00" },
        "arrival_time":   { "from": "12:00", "to": "20:00" }
      }
    ],
    "passengers": [
      {
        "type": "adult"
      }
    ],
    "cabin_class": "economy",
    "max_connections": 1
  }
}
```

- One slice = one-way. Two slices = return (or multi-city).
- `departure_time` / `arrival_time` are optional filters.
- Passenger `type`: `"adult"` | `"young_adult"` | `"child"` | `"infant"`. Or use `"age": integer` instead.
- `cabin_class`: `"economy"` | `"premium_economy"` | `"business"` | `"first"`.
- `max_connections`: default 1. Set 0 for non-stop only.

**Minimal one-way search (sandbox):**
```json
{
  "data": {
    "slices": [{ "origin": "LHR", "destination": "JFK", "departure_date": "2024-12-01" }],
    "passengers": [{ "type": "adult" }]
  }
}
```

**Response envelope:**
```json
{
  "data": {
    "id": "orq_...",
    "live_mode": false,
    "created_at": "...",
    "slices": [...],
    "passengers": [...],
    "cabin_class": "economy",
    "offers": [...],
    "client_key": "..."
  }
}
```

---

## List / Get Offers

**List offers for a request:**
```
GET /air/offers?offer_request_id={id}&limit=50&after={cursor}
```

**Get a single offer:**
```
GET /air/offers/{offer_id}
```

---

## Pagination

Cursor-based. All list endpoints support:
- `?limit=N` - 1–200, default 50
- `?after={cursor}` - next page cursor from `meta.after`
- `?before={cursor}` - previous page

Stop when `meta.after` is `null`.

```json
{
  "data": [...],
  "meta": {
    "after": "g3QAAAABZAALaW5zZXJ0ZWRfYXQ...",
    "before": null,
    "limit": 50
  }
}
```

---

## Rate Limits

- **Status on breach:** `429 Too Many Requests`
- **Error code:** `rate_limit_error` / `rate_limit_exceeded`
- **Window:** 60 seconds
- **Response headers:**
  ```
  ratelimit-limit:     <max requests per window>
  ratelimit-remaining: <requests left>
  ratelimit-reset:     <RFC 2616 timestamp when limit resets>
  ```

No specific numeric limit is published in the docs - assume it varies by plan. Implement
exponential backoff on 429; read `ratelimit-reset` for the exact retry time.

---

## Error Shape

All errors follow this envelope:
```json
{
  "errors": [
    {
      "code":              "rate_limit_exceeded",
      "type":              "rate_limit_error",
      "title":             "Rate limit exceeded",
      "message":           "Please retry after the time in ratelimit-reset",
      "documentation_url": "https://duffel.com/docs/..."
    }
  ],
  "meta": {
    "request_id": "FqMU...",
    "status": 429
  }
}
```

**Error types:**
- `authentication_error` - bad/missing token
- `validation_error` - bad request body (includes `source.field` / `source.pointer`)
- `invalid_request_error` - malformed request
- `invalid_state_error` - transition not allowed
- `airline_error` - upstream airline error
- `rate_limit_error` - 429
- `api_error` - Duffel internal error (5xx)

**HTTP status codes used:** 200, 201, 202, 204, 400, 401, 403, 404, 406, 422, 429, 500, 502, 503, 504

---

## Current build status (corrected 2026-07-10 - this section was stale)

- `POST /air/orders` (order/booking creation) - **LIVE**, see
  src/lib/duffel/orders.ts and POST /api/booking.
- Payment (Stripe PaymentIntent + webhook) - **LIVE**, see
  src/app/api/stripe/payment-intent and src/app/api/stripe/webhook.
- Seat/baggage ancillary data (`available_services` on Offer) - surfaced in
  the booking UI ("View bag & seat options" / "View seat map"); not
  independently re-verified whether the full purchase flow for these
  ancillaries is wired end-to-end.
- **Order changes/cancellations - still genuinely not built.** No
  `POST /air/order_cancellations` call exists anywhere in the repo. This is
  the real, current gap (see the account-recovery/admin-surface/refund
  planning work for the up-to-date status).
