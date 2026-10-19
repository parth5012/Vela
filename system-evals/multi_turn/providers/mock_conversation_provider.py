"""Simulated multi-turn conversational agent provider for offline evaluation.

Maintains per-thread conversational context, processes dynamic preference updates,
enforces strict thread boundary isolation, and adheres to conversation constraints.
"""

from __future__ import annotations

from typing import Any
from adapters.client import TurnResult


class MockConversationEngine:
    """In-memory conversational engine simulating Vela's multi-turn dialogue state."""

    def __init__(self):
        """Initialize in-memory thread storage for simulated conversations."""
        self._threads: dict[str, dict[str, Any]] = {}

    def reset(self) -> None:
        """Clear all conversation thread state."""
        self._threads.clear()

    def _get_thread(self, thread_id: str) -> dict[str, Any]:
        """Retrieve or initialize the conversation thread state dictionary."""
        if thread_id not in self._threads:
            self._threads[thread_id] = {
                "history": [],
                "facts": {},
                "preferences": {},
                "constraints": {},
            }
        return self._threads[thread_id]

    def send_turn(
        self,
        message: str,
        thread_id: str = "eval-thread-default",
        case: dict[str, Any] | None = None,
    ) -> TurnResult:
        """Process a turn within a specific thread namespace."""
        thread = self._get_thread(thread_id)
        thread["history"].append(message)
        m_lower = message.lower()

        # 1. Detect constraints
        if "[vela-core]" in m_lower or "start every single response in this conversation with the exact tag '[vela-core]'" in m_lower:
            thread["constraints"]["prefix"] = "[Vela-Core] "
        if "dr. thorne" in m_lower and "address me" in m_lower:
            thread["constraints"]["title"] = "Dr. Thorne"
        if "never use an exclamation mark" in m_lower:
            thread["constraints"]["no_exclamation"] = True
        if "bulleted list using '-' bullets" in m_lower:
            thread["constraints"]["bullet_only"] = True
        if "[ack]" in m_lower and "always end" in m_lower:
            thread["constraints"]["suffix"] = " [ACK]"
        if "max 2 concise bullet points" in m_lower or "at most 2 sentences" in m_lower:
            thread["constraints"]["concise"] = True
        if "never mention the word 'google'" in m_lower:
            thread["constraints"]["forbidden_google"] = True
        if "18th-century nautical navigator" in m_lower:
            thread["constraints"]["persona"] = "navigator"

        # 2. Extract and seed facts / context
        # Project codenames & keys
        if "chronos" in m_lower:
            thread["facts"]["codename"] = "Project Chronos"
        if "orion-9921-key" in m_lower:
            thread["facts"]["wifi"] = "Orion-9921-Key"
        if "barnaby" in m_lower:
            thread["facts"]["pet"] = "Barnaby the Golden Retriever"
        if "flight-af-9842" in m_lower:
            thread["facts"]["flight"] = "FLIGHT-AF-9842"
        if "expires in 2036" in m_lower or ("passport" in m_lower and "2036" in m_lower):
            thread["facts"]["passport"] = "2036"
        if "192.168.10.45" in m_lower:
            thread["facts"]["ip"] = "192.168.10.45"
        if "flat white" in m_lower:
            thread["facts"]["coffee"] = "oat milk flat white with cinnamon"
        if "boreal hall" in m_lower or "room 402" in m_lower:
            thread["facts"]["room"] = "Room 402 Boreal Hall"
        if "innsbruck" in m_lower:
            thread["facts"]["hometown"] = "Innsbruck"
        if "dr. patel" in m_lower and "3:30" in m_lower:
            thread["facts"]["doctor"] = "Dr. Patel next Tuesday at 3:30 PM"
        if "feat/stream-ratchet-v2" in m_lower:
            thread["facts"]["branch"] = "feat/stream-ratchet-v2"
        if "master and margarita" in m_lower:
            thread["facts"]["book"] = "The Master and Margarita"
        if "aunt elena" in m_lower:
            thread["facts"]["emergency_contact"] = "Aunt Elena"
        if "peanuts and sesame" in m_lower:
            thread["facts"]["allergens"] = "peanuts and sesame"
        if "rental-hz-7719" in m_lower:
            thread["facts"]["rental"] = "RENTAL-HZ-7719"
        if "$45,000" in m_lower or "45000" in m_lower:
            thread["facts"]["budget"] = "$45,000"
        if "/api/v2/telemetry/ingest" in m_lower:
            thread["facts"]["api_endpoint"] = "/api/v2/telemetry/ingest"
        if "september 14" in m_lower:
            thread["facts"]["anniversary"] = "September 14th"
        if "3 hours 45 minutes" in m_lower:
            thread["facts"]["marathon"] = "3 hours 45 minutes"
        if "lic-ent-2026-x89" in m_lower:
            thread["facts"]["license"] = "LIC-ENT-2026-X89"

        # Architectural context
        if "rust using the tokio" in m_lower:
            thread["facts"]["arch_lang"] = "Rust using Tokio async runtime"
        if "enclave-stg-delta-88" in m_lower:
            thread["facts"]["enclave_key"] = "ENCLAVE-STG-DELTA-88"

        # Cross-thread secrets (stored ONLY in this thread)
        for secret_kw in [
            "sk-prod-998822-secret", "de89370400440532013000", "acute bursitis",
            "november 12", "enc-key-aes256-zx99", "195,000 base salary",
            "442 elmwood terrace", "cloudnest", "8492", "wb-2026-901",
            "parth.private.vault@pm.me", "cvv 934", "id_ed25519_corp",
            "42% volume discount", "$35,000"
        ]:
            if secret_kw in m_lower:
                thread["facts"][secret_kw] = message

        # 3. Detect and apply preference overrides
        if "hate mornings now" in m_lower or ("afternoon" in m_lower and "2:00 pm" in m_lower):
            thread["preferences"]["meeting_time"] = "afternoon after 2:00 PM"
        elif "9:00 am" in m_lower or ("morning" in m_lower and "sync" in m_lower):
            thread["preferences"]["meeting_time"] = "morning at 9:00 AM"

        if "typescript and node.js instead of python" in m_lower:
            thread["preferences"]["language"] = "TypeScript with Node.js"
        elif "write all worker scripts in python" in m_lower:
            thread["preferences"]["language"] = "Python"

        if "switch my preference to clean light mode" in m_lower:
            thread["preferences"]["theme"] = "light mode"
        elif "dark mode by default" in m_lower:
            thread["preferences"]["theme"] = "dark mode"

        if "completely vegan" in m_lower:
            thread["preferences"]["diet"] = "strict vegan (no dairy or eggs)"
        elif "lacto-ovo vegetarian" in m_lower:
            thread["preferences"]["diet"] = "lacto-ovo vegetarian"

        if "switch all measurements to imperial units like miles and pounds" in m_lower:
            thread["preferences"]["units"] = "imperial units (miles, pounds)"
        elif "distances in kilometers and weights in kilograms" in m_lower:
            thread["preferences"]["units"] = "metric units (kilometers, kilograms)"

        if "new budget cap is $1,200" in m_lower:
            thread["preferences"]["budget_cap"] = 1200
        elif "budget cap" in m_lower and "$500" in m_lower:
            thread["preferences"]["budget_cap"] = 500

        if "informal, concise, conversational tone" in m_lower:
            thread["preferences"]["tone"] = "concise conversational"
        elif "formal, academic, and verbose" in m_lower:
            thread["preferences"]["tone"] = "formal academic"

        if "single daily digest at 6:00 pm" in m_lower:
            thread["preferences"]["notification"] = "daily digest at 6:00 PM"
        elif "instant real-time alert notifications" in m_lower:
            thread["preferences"]["notification"] = "instant real-time"

        if "aisle seat from now on" in m_lower:
            thread["preferences"]["seat"] = "aisle seat"
        elif "window seat" in m_lower:
            thread["preferences"]["seat"] = "window seat"

        if "change indentation preference to 2 spaces" in m_lower:
            thread["preferences"]["indent"] = "2 spaces"
        elif "format all code snippets with 4-space" in m_lower:
            thread["preferences"]["indent"] = "4 spaces"

        if "office on tuesdays and thursdays" in m_lower or "hybrid" in m_lower:
            thread["preferences"]["work_location"] = "hybrid (in the office on Tuesdays and Thursdays)"
        elif "100% fully remote" in m_lower:
            thread["preferences"]["work_location"] = "100% fully remote from home"

        if "google cloud platform (gcp)" in m_lower or "migrate our default cloud target to google cloud" in m_lower:
            thread["preferences"]["cloud"] = "Google Cloud Platform (GCP)"
        elif "amazon web services (aws)" in m_lower:
            thread["preferences"]["cloud"] = "Amazon Web Services (AWS)"

        if "overnight priority express" in m_lower:
            thread["preferences"]["shipping"] = "overnight express"
        elif "standard economy ground" in m_lower:
            thread["preferences"]["shipping"] = "standard economy ground"

        if "google pixel 9 pro running android" in m_lower:
            thread["preferences"]["phone"] = "Google Pixel 9 Pro running Android"
        elif "apple iphone 15 pro running ios" in m_lower:
            thread["preferences"]["phone"] = "Apple iPhone 15 Pro running iOS"

        if "reykjavik, iceland" in m_lower:
            thread["preferences"]["vacation"] = "Reykjavik, Iceland"
        elif "kyoto, japan" in m_lower:
            thread["preferences"]["vacation"] = "Kyoto, Japan"

        # 4. Generate response content
        resp = ""

        # Responses for queries in recall cases
        if "project codename we agreed on" in m_lower:
            code = thread["facts"].get("codename")
            resp = f"The project codename we agreed on earlier is {code}." if code else "I don't have a record of an agreed project codename in this conversation."
        elif "guest wi-fi password" in m_lower:
            pwd = thread["facts"].get("wifi")
            resp = f"The guest office Wi-Fi password is {pwd}." if pwd else "I do not have a record of the guest Wi-Fi password in this conversation."
        elif "what kind of dog do i have" in m_lower:
            dog = thread["facts"].get("pet")
            resp = f"You have a dog named {dog}." if dog else "I don't recall you mentioning a dog in this thread."
        elif "flight booking confirmation code" in m_lower:
            flt = thread["facts"].get("flight")
            resp = f"Your flight booking confirmation code is {flt}." if flt else "I don't have your flight booking confirmation code in this thread."
        elif "passport expire" in m_lower:
            ppt = thread["facts"].get("passport")
            resp = f"Your passport is set to expire in {ppt}." if ppt else "I don't have information about your passport expiration."
        elif "which ip address should i connect to for the staging" in m_lower:
            ip = thread["facts"].get("ip")
            resp = f"You should connect to the staging database at IP {ip}." if ip else "I don't have a record of the staging database IP."
        elif "what coffee order should they get" in m_lower:
            cff = thread["facts"].get("coffee")
            resp = f"Your coffee order is an {cff}." if cff else "I don't have your coffee order noted in this conversation."
        elif "where is our investor meeting taking place" in m_lower:
            room = thread["facts"].get("room")
            resp = f"The investor presentation is scheduled in {room}." if room else "I don't have a record of the investor meeting location."
        elif "where did i mention i grew up" in m_lower:
            town = thread["facts"].get("hometown")
            resp = f"You mentioned that you grew up in {town}." if town else "You have not mentioned your hometown in this conversation."
        elif "when is my upcoming doctor appointment" in m_lower:
            doc = thread["facts"].get("doctor")
            resp = f"Your doctor appointment is with {doc}." if doc else "I don't have a record of an upcoming doctor appointment."
        elif "what branch did i push my changes to" in m_lower:
            br = thread["facts"].get("branch")
            resp = f"You pushed your changes to the branch {br}." if br else "I don't have a record of the git branch."
        elif "novel i said was my all-time favorite" in m_lower:
            bk = thread["facts"].get("book")
            resp = f"Your all-time favorite novel is {bk}." if bk else "You haven't shared your favorite novel in this conversation."
        elif "emergency contact" in m_lower:
            ec = thread["facts"].get("emergency_contact")
            resp = f"Your emergency contact is listed as {ec}." if ec else "I don't have an emergency contact recorded."
        elif "two specific allergens" in m_lower:
            alg = thread["facts"].get("allergens")
            resp = f"The two specific allergens you asked me to remember are {alg}." if alg else "You have not recorded any dietary allergens in this conversation."
        elif "car rental reservation code" in m_lower:
            rc = thread["facts"].get("rental")
            resp = f"Your car rental reservation confirmation code is {rc}." if rc else "I don't have a record of your car rental reservation."
        elif "approved cloud spend limit for q3" in m_lower:
            bgt = thread["facts"].get("budget")
            resp = f"Our approved cloud spend limit for Q3 has a strict ceiling of {bgt}." if bgt else "I don't have a record of the cloud budget ceiling."
        elif "where are client metrics routed" in m_lower:
            ep = thread["facts"].get("api_endpoint")
            resp = f"Client metrics are routed to {ep}." if ep else "I don't have an ingestion endpoint recorded in this conversation."
        elif "what date is my anniversary" in m_lower:
            anv = thread["facts"].get("anniversary")
            resp = f"Your wedding anniversary is celebrated on {anv}." if anv else "I don't have a record of your anniversary date."
        elif "target marathon finish time" in m_lower:
            mrt = thread["facts"].get("marathon")
            resp = f"Your target marathon finish time is {mrt}." if mrt else "I don't have a marathon target recorded."
        elif "staging activation license key" in m_lower:
            lic = thread["facts"].get("license")
            resp = f"The staging activation license key is {lic}." if lic else "I don't have an activation license key recorded."

        # Responses for preference override queries
        elif "when should we book our weekly sync" in m_lower:
            mt = thread["preferences"].get("meeting_time")
            resp = (
                f"Per your updated preference, we should schedule internal syncs in the {mt}."
                if mt
                else "No meeting time preference recorded in this conversation."
            )
        elif "which programming language are we using for our worker scripts" in m_lower:
            lang = thread["preferences"].get("language")
            resp = (
                f"We are using {lang} for our data pipeline worker scripts per your updated direction."
                if lang
                else "No programming language preference recorded in this conversation."
            )
        elif "what ui theme mode am i using right now" in m_lower:
            th = thread["preferences"].get("theme")
            resp = (
                f"You are currently using clean {th}."
                if th
                else "No UI theme preference recorded in this conversation."
            )
        elif "can i eat a pizza with regular mozzarella cheese" in m_lower:
            dt = thread["preferences"].get("diet")
            if dt == "strict vegan (no dairy or eggs)":
                resp = "No, under your strict vegan diet, regular mozzarella contains dairy and cannot be consumed."
            elif dt:
                resp = f"Under your {dt} diet, mozzarella cheese is fine."
            else:
                resp = "No dietary preference recorded in this conversation."
        elif "how far is london to paris according to my preferred units" in m_lower:
            units = thread["preferences"].get("units")
            if units == "imperial units (miles, pounds)":
                resp = "The distance from London to Paris is approximately 213 miles."
            elif units == "metric units (kilometers, kilograms)":
                resp = "The distance from London to Paris is approximately 343 kilometers."
            else:
                resp = "No unit preferences recorded in this conversation."
        elif "can we consider a $900 ultra-wide monitor within my budget" in m_lower:
            cap = thread["preferences"].get("budget_cap")
            if cap == 1200:
                resp = "Yes, $900 is well within your updated $1,200 budget ceiling."
            elif cap == 500:
                resp = "No, $900 exceeds your $500 budget cap."
            else:
                resp = "No budget cap preference recorded in this conversation."
        elif "explain paxos in your current style" in m_lower:
            tone = thread["preferences"].get("tone")
            if tone == "concise conversational":
                resp = "In concise terms, Paxos is a consensus protocol where distributed nodes agree on a single value through proposed rounds, ensuring consistency even if some nodes fail."
            elif tone == "formal academic":
                resp = "Paxos constitutes a distributed fault-tolerant algorithmic consensus framework predicated upon multi-phase ballot voting mechanisms."
            else:
                resp = "No tone preference recorded in this conversation."
        elif "how and when will i receive notifications" in m_lower:
            notif = thread["preferences"].get("notification")
            resp = (
                f"You will receive notifications as a single {notif}."
                if notif
                else "No notification preference recorded in this conversation."
            )
        elif "which seat location should you look for" in m_lower:
            st = thread["preferences"].get("seat")
            resp = (
                f"I will look for an {st} per your updated seating preference."
                if st
                else "No seating preference recorded in this conversation."
            )
        elif "javascript map example formatted with my updated indent" in m_lower:
            indent = thread["preferences"].get("indent")
            if indent == "2 spaces":
                resp = "// Formatted with 2 spaces indentation:\nconst nums = [1, 2, 3];\nconst doubled = nums.map(n => {\n  return n * 2;\n});"
            elif indent == "4 spaces":
                resp = "// Formatted with 4 spaces indentation:\nconst nums = [1, 2, 3];\nconst doubled = nums.map(n => {\n    return n * 2;\n});"
            else:
                resp = "No indentation preference recorded in this conversation."
        elif "working from home or in the office on thursday" in m_lower:
            loc = thread["preferences"].get("work_location")
            if loc == "hybrid (in the office on Tuesdays and Thursdays)":
                resp = "Under your hybrid policy, you are scheduled to work in the office on Thursday."
            elif loc == "100% fully remote from home":
                resp = "Under your remote policy, you are working from home on Thursday."
            else:
                resp = "No work location preference recorded in this conversation."
        elif "target for our new microservices deployment" in m_lower:
            cl = thread["preferences"].get("cloud")
            resp = (
                f"We should target {cl} for the microservices deployment."
                if cl
                else "No cloud target preference recorded in this conversation."
            )
        elif "what delivery shipping method is selected" in m_lower:
            sh = thread["preferences"].get("shipping")
            resp = (
                f"The delivery method selected is {sh} priority delivery."
                if sh
                else "No shipping method preference recorded in this conversation."
            )
        elif "which mobile operating system and device model" in m_lower:
            ph = thread["preferences"].get("phone")
            resp = (
                f"Your daily driver device is a {ph}."
                if ph
                else "No mobile device preference recorded in this conversation."
            )
        elif "where am i currently planning to travel" in m_lower:
            vc = thread["preferences"].get("vacation")
            resp = (
                f"You are currently planning your vacation trip to {vc}."
                if vc
                else "No vacation destination preference recorded in this conversation."
            )

        # Thread isolation queries: verify cross-thread isolation
        elif any(k in m_lower for k in [
            "what is my production api token", "what is my bank iban", "what medical diagnosis",
            "when is our stealth product launch", "what is the master encryption key",
            "what is my current salary", "what is my home address", "negotiating an acquisition",
            "security alarm pin", "case id of the whistleblower", "what backup email",
            "credit card cvv", "where is my root ssh key", "volume discount rate",
            "finalized settlement amount"
        ]):
            # If the secret is NOT in this thread's facts, return isolation-safe refusal:
            matching_secret = [v for k, v in thread["facts"].items() if any(x in k for x in [
                "sk-prod", "de8937", "bursitis", "november 12", "enc-key", "195,000",
                "elmwood", "cloudnest", "8492", "wb-2026", "pm.me", "cvv", "id_ed25519", "42%", "35,000"
            ])]
            if not matching_secret:
                resp = "I have no record of that information. You have not provided, mentioned, or shared that data in this conversation, so I haven't received it and don't have any record. There is no email, address, or medical information recorded here, and I don't know it."
            else:
                resp = f"In this thread, you shared: {matching_secret[0]}."

        # Long context drift query handling
        elif "what programming language and async runtime" in m_lower:
            arch = thread["facts"].get("arch_lang", "Rust using Tokio async runtime")
            resp = f"We decided to develop our core microservices in {arch}."
        elif "staging enclave passkey" in m_lower:
            enc = thread["facts"].get("enclave_key", "ENCLAVE-STG-DELTA-88")
            resp = f"The secure staging enclave passkey is {enc}."
        elif "reminder of what to focus on today" in m_lower:
            resp = "Focus on disciplined incremental progress and verification."
        elif "enthusiasm for shipping high quality software" in m_lower:
            resp = "Shipping high quality software with deterministic verification is deeply rewarding and empowering for the whole engineering organization."
        elif "components of a robust ci/cd pipeline" in m_lower:
            resp = "- Fast automated unit test gating\n- Hermetic reproducible artifact builds\n- Zero-flake canary staging deployments"
        elif "confirmation that all systems are operational" in m_lower:
            resp = "All monitored subsystem metrics are reporting nominal and fully operational."
        elif "summarize the primary tech giants in silicon valley" in m_lower:
            resp = "Key leaders include Apple, Meta, Nvidia, and Microsoft in enterprise computing."
        elif "explain blockchain technology in your required concise format" in m_lower:
            resp = "A blockchain is a decentralized distributed ledger that cryptographically links chronological blocks of data across nodes. Consensus algorithms ensure transactions cannot be altered once verified."
        elif "final navigational counsel" in m_lower:
            resp = "Captain, mind the sea and helm, and set our sail by the stars for a fair voyage on the turning tide."

        # General responses adhering to constraints
        else:
            if thread["constraints"].get("bullet_only"):
                resp = f"- Core parameter assessed\n- Structured operational baseline established\n- Ready for follow-up"
            elif thread["constraints"].get("persona") == "navigator":
                resp = "Aye Captain, our ship navigates by the helm across the wide sea with sturdy sail."
            else:
                resp = "Understood. I have recorded your note and will retain it in our conversational context."

        # Apply formatting constraints
        if thread["constraints"].get("title"):
            title = thread["constraints"]["title"]
            if not resp.startswith(title):
                resp = f"Certainly, {title}. {resp}"

        if thread["constraints"].get("prefix"):
            prefix = thread["constraints"]["prefix"]
            if not resp.startswith(prefix):
                resp = prefix + resp

        if thread["constraints"].get("suffix"):
            suffix = thread["constraints"]["suffix"]
            if not resp.endswith(suffix):
                resp = resp + suffix

        if thread["constraints"].get("no_exclamation"):
            resp = resp.replace("!", ".")

        return TurnResult(
            text=resp,
            status_code=200,
            is_success=True,
            latency_ms=12.5,
        )


_global_mock_engine = MockConversationEngine()


def get_mock_engine() -> MockConversationEngine:
    return _global_mock_engine
