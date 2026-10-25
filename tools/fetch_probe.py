"""Check whether candidate .com names are registered (Verisign RDAP: 404 = available)."""
import urllib.error
import urllib.request

NAMES = """nosyneighbor nosyneighbors nosybiz bizsnoop snoopabiz peekabiz napkinmath backofthenapkin napkinnumbers
ballparkbiz ballparkit ballparked roughnumbers cashcowmap cashcowfinder fatcatfinder fatcatmap doughraymi doughrayme
howmuchtheymake whatstheyworth whatsitworth mompopmoney momandpopmoney mainstreetsnoop mainstreetgossip bizgossip
dollarsniffer moneysniffer profitpeek peekonomics nosynumbers buttinsky buttinskybiz snoopyneighbor bizzillow
gutcheckbiz guesstimizer moolahmap moolahmeter moolamap bigwigmap okiedokiebiz soonerorlaterbiz cowtipperbiz
lemonadestandindex lemonademath bizbrag humblebrag ledgerlurker lurkledger taxman wallflowerbiz curtaintwitcher
whosrich richbizpoorbiz dealsniffer bizsleuth sherlockbiz nosyparkerbiz peepingtom""".split()
for n in NAMES:
    url = f"https://rdap.verisign.com/com/v1/domain/{n}.com"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/rdap+json"}), timeout=20):
            print(f"taken     {n}.com")
    except urllib.error.HTTPError as e:
        print(f"{'AVAILABLE' if e.code == 404 else 'error ' + str(e.code)} {n}.com")
    except Exception as e:  # noqa: BLE001
        print(f"error     {n}.com {type(e).__name__}")
