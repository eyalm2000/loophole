# Loophole

## Overview

Loophole gives Android's Private DNS a DNS-over-HTTPS endpoint it can discover on its own, so system-wide encrypted DNS keeps working on networks that block port 853. It is a Cloudflare Worker you deploy to your own account, plus documentation for the Android flags that make discovery work. No VPN, no root.

## Why a gateway is needed

Android's Private DNS connects over DNS-over-TLS on port 853. On networks that block that port (university Wi-Fi, hotels, airports, some workplaces), it stops working entirely. What happens on such a network depends on which group your provider is in.

With the flags on, Android discovers DoH endpoints itself through DDR: it looks up a special SVCB DNS record named `_dns.<hostname>` before connecting, and if that record advertises a DoH path, Android skips port 853 and talks DoH, usually over HTTP/3.

| Group | Providers | On a network that blocks port 853 |
| --- | --- | --- |
| Hardcoded into Android | Google (dns.google), Cloudflare (cloudflare-dns.com) | DoH works, no flags needed |
| Works without the flags | All providers with a DoT endpoint (stock Private DNS) | Works only where port 853 is open; breaks where it is blocked |
| Works with the flags | Quad9 (dns.quad9.net) and other supported providers | DoH works via DDR |
| Not supported | NextDNS, AdGuard DNS, Control D, OpenDNS, CleanBrowsing, Mullvad DNS, and most others | Fails even with the flags; needs the worker |

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
