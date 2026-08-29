# tierstack

Official Python SDK for the [Tierstack](https://gettierstack.com) API.

```python
from tierstack import Tierstack

client = Tierstack(api_key="sk_test_...", base_url="https://api.gettierstack.com")

result = client.subscriptions.create(
    customer={"email": "ada@example.com"},
    price_id="price_starter_monthly",
)
```

Every method returns the response's `data` directly, or raises `TierstackError` —
there is no envelope to unwrap and no result to check for an `error` field.

See the [docs](https://gettierstack.com/docs) for the full API reference.
