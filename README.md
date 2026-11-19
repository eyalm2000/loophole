# Loophole

## Overview

Loophole gives Android's Private DNS a DNS-over-HTTPS endpoint it can discover on its own, so system-wide encrypted DNS keeps working on networks that block port 853. It is a Cloudflare Worker you deploy to your own account, plus documentation for the Android flags that make discovery work. No VPN, no root.

## Why a gateway is needed

Android's Private DNS connects over DNS-over-TLS on port 853. On networks that block that port (university Wi-Fi, hotels, airports, some workplaces), it stops working entirely. What happens on such a network depends on which group your provider is in.

With the flags on, Android discovers DoH endpoints itself through DDR: it looks up a special SVCB DNS record named `_dns.<hostname>` before connecting, and if that record advertises a DoH path, Android skips port 853 and talks DoH, usually over HTTP/3.

| Group                   | Providers                                                                             | On a network that blocks port 853                             |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Hardcoded into Android  | Google (dns.google), Cloudflare (cloudflare-dns.com)                                  | DoH works, no flags needed                                    |
| Works without the flags | All providers with a DoT endpoint (stock Private DNS)                                 | Works only where port 853 is open; breaks where it is blocked |
| Works with the flags    | Quad9 (dns.quad9.net) and other supported providers                                   | DoH works via DDR                                             |
| Not supported           | NextDNS, AdGuard DNS, Control D, OpenDNS, CleanBrowsing, Mullvad DNS, and most others | Fails even with the flags; needs the worker                   |

Among major DNS services, Quad9 is the only one that supports DDR and needs the flag turned on. Google and Cloudflare do not need it because they are hardcoded. Most DNS services do not publish DDR records at all.

That is what this worker is for: it gives you a DoH endpoint on your own domain, and you publish the SVCB record for it. Android then discovers your gateway the same way it discovers Quad9's, and your gateway forwards queries to whatever upstream you configured. The filtering service never needs to support DDR itself.

## Getting Started

### 1. Guided setup (recommended)

Use this if you want the worker. Requires Android 16 or later, and a domain.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/eyalm2000/loophole)

1. Click the button above.
2. Log in to Cloudflare (a free account is fine).
3. Select your GitHub account and keep the other settings on their defaults, then click Deploy.
4. When it finishes, click Visit, and follow the instructions from there.

The Cloudflare free plan is enough for personal use (100,000 requests per day), and the Worker runs on Cloudflare's edge, so it adds minimal latency to your queries.

### 2. Flags only

Use this if your provider publishes DDR records (Quad9 and other supported providers) and you do not need a worker. Requires Android 16 or later.

Run the two commands in [Enable the flags](#enable-the-flags) below, set your Private DNS hostname to your provider's hostname (for example `dns.quad9.net`), and toggle airplane mode.

### 3. Your own DoH endpoint or DNS

Use this if you already run a DoH endpoint or your own DNS. Requires a DoH endpoint and control of its DNS zone.

You need one DNS record. In your domain's DNS zone (wherever your domain's DNS is hosted), add a record with these fields:

- Type: SVCB
- Name: `_dns.<your-hostname>` (the exact hostname you will enter in Private DNS, with `_dns.` in front)
- Priority: 1
- TTL: Auto
- Target: `<your-hostname>.` (your DoH server's hostname, with a trailing dot)
- Parameters: `alpn="h3" dohpath="/dns-query{?dns}"`

So for a hostname like `dns.example.com`, the record is: name `_dns.dns.example.com`, target `dns.example.com.`, parameters `alpn="h3" dohpath="/dns-query{?dns}"`.

Adjust two things to match your server: if it does not serve HTTP/3, use `alpn="h2"` (or `alpn="h2,h3"` if it serves both); if your DoH path is not `/dns-query`, put your path in `dohpath` instead. If your endpoint runs on a port other than 443, add `port=<number>` to the parameters.

Then check the record is actually published before testing on your phone. From any terminal:

```text
dig _dns.<your-hostname> SVCB
```

Wait for the record to show up: DNS changes can take a few minutes to propagate. After that, run the commands in [Enable the flags](#enable-the-flags), set your Private DNS hostname to your hostname, and toggle airplane mode. No Loophole worker is involved.

## Enable the flags

You need Shizuku (on the phone, no computer) or ADB (from a computer).

**Shizuku:** install [Shizuku](https://shizuku.rikka.app/download/), pair it through wireless debugging, then install [aShell You](https://github.com/DP-Hridayan/aShellYou) and allow it Shizuku access. Run the commands below there, exactly as written.

**ADB:** install [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools), enable Developer options and USB debugging, connect by USB, and run `adb devices` to confirm your phone shows up. In Windows PowerShell, use `.\adb` instead of `adb`.

Run each command separately. A successful command usually prints nothing. The commands are written with the `adb shell` prefix, which works the same in a computer terminal and in aShell You, so copy them as they are.

```text
adb shell device_config put connectivity dns_ddr_version 1
adb shell device_config put connectivity networkmonitor_async_privdns_resolution 1
```

**Required last step: turn airplane mode on, wait a few seconds, then turn it off.** Android only applies the change after a reconnect. Without this, setup will not work.

Check that both settings stuck (each should return `1`):

```text
adb shell device_config get connectivity dns_ddr_version
adb shell device_config get connectivity networkmonitor_async_privdns_resolution
```

If the settings keep resetting, this disables DeviceConfig synchronization for the whole phone. Use it only if needed:

```text
adb shell device_config set_sync_disabled_for_tests persistent
```

To revert back:

```text
adb shell device_config set_sync_disabled_for_tests none
```

## Connectivity test

The dashboard has a **Test connectivity** button. It runs once per click, never in the background, and only one test can run at a time per gateway. It shares the resolver-test rate limit (12 per minute). Each check reports one of four results:

- `PASS`: the check ran and its success conditions were verified.
- `FAIL`: the check ran and a known condition failed.
- `INCONCLUSIVE`: there was not enough evidence to decide.
- `UNSUPPORTED`: this deployment cannot perform the check.

A timeout, a skipped check, or missing data is never reported as `PASS`.

| Check                                   | Runs in       | What a `PASS` shows                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker and Durable Object               | Worker        | The Worker handled the request, and its Durable Object validated your session and returned your saved settings.                                                                                                                                                                                                                                                                                  |
| Settings in Workers KV                  | Worker        | A direct KV read at the Cloudflare location that served you returned the same settings revision the dashboard saved. A different revision (older or newer) is `INCONCLUSIVE`. Right after a save this is normal for up to a minute.                                                                                                                                                              |
| Custom domain from this browser         | Your browser  | This browser reached your custom domain over HTTPS and got a valid Loophole response. It does not prove public DNS propagation or reachability from other networks. If the dashboard is open on another address, the result is `INCONCLUSIVE`.                                                                                                                                                   |
| End-to-end DoH query                    | Worker        | A fixed query went through the same handler that serves `/dns-query`, using the settings `/dns-query` uses at that location right now (including its short cache), which matched the saved revision. It returned a valid `NOERROR` answer with the same transaction ID and question. If the revisions differ, the result is `INCONCLUSIVE`. If `/dns-query` has no valid settings, it is `FAIL`. |
| Saved upstream resolver                 | Worker        | Your saved resolver answered the fixed query directly with a valid, matching `NOERROR` answer.                                                                                                                                                                                                                                                                                                   |
| Observed client-to-Cloudflare IP family | Worker        | Cloudflare's `CF-Connecting-IP` / `CF-Connecting-IPv6` metadata shows whether this browser reached Cloudflare over IPv4 or IPv6. It shows nothing about your phone or about Cloudflare's connection to the resolver.                                                                                                                                                                             |
| IPv4-only / IPv6-only enforcement       | Not performed | Always `UNSUPPORTED`. See below.                                                                                                                                                                                                                                                                                                                                                                 |

The test query is always `example.com`, type `A`, with a new random non-zero transaction ID. The Worker only uses your saved settings and ignores anything the browser sends, so the test cannot be pointed at another server. Results include no upstream URL, NextDNS profile ID, device name, IP address, or DNS packet. The Worker logs nothing.

A `PASS` on the DNS checks shows only that this one `example.com` A query got a valid answer. It does not show that your NextDNS filtering rules, account settings, or other record types work.

When the resolver check fails, its result names the cause: a request failure before any HTTP response (connection, TLS, or another runtime fetch error, which the runtime does not tell apart), timeout (8 seconds), HTTP status, redirect, wrong content type, malformed DNS message, transaction ID mismatch, question mismatch, or a DNS error code such as `SERVFAIL`. In a browser, the custom-domain check cannot tell DNS, TLS, and routing failures apart, so it reports them together.

### IPv4 and IPv6

Loophole has no IPv4-only or IPv6-only mode, and the connectivity test does not test one.

- **Phone to Cloudflare:** your phone's network and the A/AAAA records Cloudflare publishes for your domain decide the IP family. Worker code cannot change it.
- **Cloudflare to your resolver:** the Workers `fetch()` API has no documented option to explicitly select or enforce the IP family of outbound connections, so Loophole cannot force or verify IPv4 or IPv6 here.
- **SVCB record:** `alpn="h3"` or `alpn="h2"` selects the HTTP version, not IPv4 or IPv6. The `ipv4hint` and `ipv6hint` parameters are hints, not enforcement.

### Troubleshooting with a VPN

Some users report that Private DNS with a Loophole hostname stops working while a VPN is connected, while a provider's own DNS-over-TLS hostname (for example NextDNS) keeps working. The root cause has not been confirmed. This section separates what is known from what still needs testing.

**Known facts**

- A Loophole hostname has a single transport: DNS-over-HTTPS that Android finds through the `_dns.<hostname>` SVCB record (DDR). Loophole's suggested record advertises only `h3`, so Android connects over HTTP/3, which runs on QUIC over UDP port 443.
- A Worker cannot serve DNS-over-TLS on port 853. If Android cannot discover the SVCB record or cannot connect over HTTP/3, this Worker provides no working DoT fallback. Android may still try DoT on port 853, but nothing there answers for a Loophole hostname. A provider's DoT hostname uses TCP port 853 and does not depend on DDR, which is why it can behave differently.
- The setup check reads the SVCB record through Cloudflare's public resolver. It does not show what the resolver your phone uses while the VPN is on returns. DDR allows that lookup to go through any resolver (RFC 9462, section 5).
- Some VPN apps route DNS through their tunnel and recommend not using Private DNS, DoH, or DoT with them. Some also have DNS-filtering features that cannot be combined with custom DNS. Check your VPN provider's documentation.
- Cloudflare publishes A and AAAA records for proxied hostnames. On non-Enterprise plans, IPv6 compatibility cannot be turned off ([IPv6 compatibility](https://developers.cloudflare.com/network/ipv6-compatibility/)). Loophole cannot choose the IP family on either side.
- The dashboard's IP-family result describes only the browser running the test. It says nothing about the IP family your phone's Private DNS connection uses.

**Hypotheses (unconfirmed)**

1. While the VPN is on, the resolver Android uses does not return the SVCB record, so Android never learns about DoH.
2. QUIC (UDP 443) does not get through the VPN tunnel, for example with a TCP-based VPN protocol.
3. The phone tries IPv6 for the Loophole hostname while the tunnel blocks IPv6. Note that a provider's DoT hostname can also have AAAA records.
4. Cloudflare security features (Bot Fight Mode, Security Level, WAF rules) challenge requests from VPN addresses before the Worker runs.
5. Android or GrapheneOS handles Private DNS on VPN networks differently.

**Tests**

Change one setting at a time. Write down the VPN protocol, any DNS-filtering feature, custom DNS, and kill switch settings first. Do not leave any protection turned off.

| Step | What to do                                                                                                                                                                                                                                                                                                                                                                                | What it can show                                                                                                                                                           | What it cannot show                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | VPN off, Loophole hostname: save the output of `adb shell dumpsys dnsresolver`. The output format depends on the Android version.                                                                                                                                                                                                                                                         | A reference for how a working DoH setup looks on this device.                                                                                                              | Anything about the VPN.                                 |
| 2    | VPN on, Loophole hostname: save the same output, and `adb logcat -d` filtered for `DnsResolver` or `PrivateDns`.                                                                                                                                                                                                                                                                          | If no DoH server appears and only port 853 is tried, discovery is failing (hypothesis 1). If a DoH server appears but validation fails, the transport is (hypotheses 2–4). | Which transport problem it is.                          |
| 3    | VPN on, Private DNS set to the provider's DoT hostname so the phone is online. In a browser, open `https://<hostname>/dns-query?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE`. A downloaded file means the Worker returned a DNS answer. A short JSON error message comes from the Worker itself. An HTML error or challenge page is commonly served by Cloudflare before the Worker runs. | Whether HTTPS over TCP through the VPN reaches the Worker (hypothesis 4).                                                                                                  | Anything about HTTP/3, because the browser may use TCP. |
| 4    | Same state: run **Test connectivity** in the dashboard.                                                                                                                                                                                                                                                                                                                                   | Whether the Worker can reach the upstream resolver.                                                                                                                        | Anything about the phone's Private DNS path.            |
| 5    | Same state: open an IPv6 test site and an HTTP/3 test site.                                                                                                                                                                                                                                                                                                                               | Whether the tunnel carries IPv6 (hypothesis 3) and QUIC (hypothesis 2) to those sites.                                                                                     | Whether the same applies to your hostname.              |
| 6    | On a computer connected to the same VPN server, compare `dig _dns.<hostname> SVCB` with `dig @1.1.1.1 _dns.<hostname> SVCB`.                                                                                                                                                                                                                                                              | Whether the VPN's resolver returns the SVCB record (hypothesis 1).                                                                                                         | That Android uses that resolver.                        |
| 7    | If step 6 returns no record: turn off only the VPN's DNS-filtering feature, repeat step 2, then turn it back on. If step 2 points at the transport: change only the VPN protocol and repeat step 2.                                                                                                                                                                                       | Which single setting changes the outcome.                                                                                                                                  | Why the setting has that effect.                        |

## Privacy & Security

Loophole has no analytics, tracking, or ads.

#### Query logs

The gateway does not store your queries. The dashboard's connection indicator is a live check, not a log: it only confirms whether your phone is currently routing through the gateway.

#### Open endpoint

The gateway's `/dns-query` endpoint is open by design. DDR requires Android to reach it without authentication, so anyone who finds your gateway URL can send queries through it, and your upstream profile will see their traffic. Don't publish your gateway domain unless you're fine with that.

#### PIN

The dashboard is protected by a 4-digit PIN you set during setup.

#### Who sees your traffic

Your upstream provider sees your queries as normal DNS traffic. Cloudflare hosts the Worker, so queries pass through Cloudflare's edge.

## Frequently Asked Questions

#### Do I need root?

No. Loophole manages system settings via Shizuku or ADB. If your device is rooted, you can start Shizuku in root mode, but root is not required.

#### Does it work without a custom domain?

Partly. Basic DoH and the dashboard work on a `workers.dev` address, but Android hostname discovery requires a custom domain and its SVCB record. Without the domain, Private DNS cannot discover the gateway.

#### Why is the DNS endpoint open? Can't the PIN lock it?

No. DDR requires Android to reach the endpoint without authentication, so the endpoint cannot be locked. The PIN guards the dashboard only.

#### Will it drain my battery or run in the background?

No. Nothing runs on the phone after setup. Private DNS is a system setting, not an app and not a VPN, so there is no background service and no battery cost.

#### What if my provider adds DDR records later?

Then you don't need the worker for it. Use the flags-only path with your provider's hostname, the same way Quad9 works today.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
