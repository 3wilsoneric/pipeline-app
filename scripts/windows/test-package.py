"""Reject changes to the origin, identity, capabilities, or bundled executable surface."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("verify", Path(__file__).with_name("verify-package.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
CONFIG = json.loads(Path("infra/windows/package.json").read_text())


def zipped(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return result.getvalue()


def fixture(change=lambda text: text, extra=None):
    config = CONFIG
    args = (f'--app-id={config["edgeAppId"]} --ip-edge-aumid=Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!MSEDGE '
            f'--app-fallback-url={config["url"]} --display-mode=standalone --windows-store-app')
    ident = f'Name="{config["packageId"]}" Publisher="{config["publisher"]}" Version="1.0.0.0"'
    manifest = f'''<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
      xmlns:u10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:u3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3">
      <Identity {ident} ProcessorArchitecture="neutral"/><Properties><DisplayName>Pipeline</DisplayName></Properties>
      <Dependencies><u10:HostRuntimeDependency Name="Microsoft.MicrosoftEdge.Stable" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"/></Dependencies>
      <Applications><Application Id="App" u10:HostId="PWA" u10:Parameters="{args}"><Extensions>
      <u3:Extension Category="windows.appExtension"><u3:AppExtension Name="microsoft.store.edgePWA"/></u3:Extension>
      <u3:Extension Category="windows.appExtension"><u3:AppExtension Name="com.ms.webapp.internals.4" Description="parameters?{args};profile-directory?Default;start-url?{config['url']}"/></u3:Extension>
      </Extensions></Application></Applications><Capabilities><Capability Name="runFullTrust"/></Capabilities></Package>'''
    leaf = {"AppxManifest.xml": change(manifest), "resources.pri": b"fixture"}
    leaf.update(extra or {})
    return zipped({"app.appx": zipped(leaf), "AppxMetadata/AppxBundleManifest.xml":
        f'<Bundle xmlns="http://schemas.microsoft.com/appx/2013/bundle"><Identity {ident}/><Packages><Package Version="1.0.0.0" Architecture="neutral" FileName="app.appx"/></Packages></Bundle>'})


class PackageSafety(unittest.TestCase):
    def test_hosted_package(self):
        self.assertEqual(verify.validate_bundle(fixture(), CONFIG, "1.0.0.0")["architecture"], "neutral")

    def test_reject_changed_launch_origin(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(lambda t: t.replace(CONFIG["url"], "https://example.invalid/")), CONFIG, "1.0.0.0")

    def test_reject_browser_security_flags(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(lambda t: t.replace("--display-mode=standalone", "--disable-web-security --display-mode=standalone")), CONFIG, "1.0.0.0")

    def test_reject_identity_change(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(lambda t: t.replace(CONFIG["packageId"], "Another.App")), CONFIG, "1.0.0.0")

    def test_reject_extra_capability(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(lambda t: t.replace("</Capabilities>", '<Capability Name="broadFileSystemAccess"/></Capabilities>')), CONFIG, "1.0.0.0")

    def test_reject_executable_or_private_file(self):
        for name in ["helper.exe", ".env", "records.json", "../Images/icon.png"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                verify.validate_bundle(fixture(extra={name: b"refused"}), CONFIG, "1.0.0.0")

    def test_reject_wrong_version(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(), CONFIG, "1.0.1.0")

    def test_reject_xml_entity(self):
        with self.assertRaises(ValueError):
            verify.validate_bundle(fixture(lambda t: '<!DOCTYPE a [<!ENTITY b SYSTEM="file:///test">]>' + t), CONFIG, "1.0.0.0")


if __name__ == "__main__":
    unittest.main()
