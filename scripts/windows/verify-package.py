"""Inspect the hosted PWA package without executing PWABuilder's bundled installer."""
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

F = "{http://schemas.microsoft.com/appx/manifest/foundation/windows10}"
U10 = "{http://schemas.microsoft.com/appx/manifest/uap/windows10/10}"
U3 = "{http://schemas.microsoft.com/appx/manifest/uap/windows10/3}"
B = "{http://schemas.microsoft.com/appx/2013/bundle}"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    entries = z.infolist()
    require(len(entries) <= 200 and sum(e.file_size for e in entries) <= 20_000_000, "Oversized package")
    require(len({e.filename for e in entries}) == len(entries), "Duplicate archive entry")
    for entry in entries:
        require(not entry.filename.startswith(("/", "\\")) and ".." not in entry.filename.replace("\\", "/").split("/"), "Unsafe archive path")
    require(z.testzip() is None, "Invalid archive checksum")
    return z


def xml(data):
    require(b"<!DOCTYPE" not in data and b"<!ENTITY" not in data, "Unexpected XML declaration")
    return ET.fromstring(data)


def identity(element, config, version):
    require(element is not None, "Missing package identity")
    for key, expected in [("Name", config["packageId"]), ("Publisher", config["publisher"]), ("Version", version)]:
        require(element.get(key) == expected, f"Unexpected package {key}")


def validate_bundle(data, config, version):
    with archive(data) as bundle:
        root = xml(bundle.read("AppxMetadata/AppxBundleManifest.xml"))
        identity(root.find(B + "Identity"), config, version)
        packages = root.findall(B + "Packages/" + B + "Package")
        require(len(packages) == 1, "Expected one architecture-neutral hosted PWA")
        package = packages[0]
        require(package.get("Architecture") == "neutral" and package.get("Version") == version, "Unexpected bundle architecture/version")
        leaf_name = package.get("FileName")
        require(set(bundle.namelist()) <= {leaf_name, "AppxMetadata/AppxBundleManifest.xml", "AppxBlockMap.xml", "[Content_Types].xml", "AppxSignature.p7x", "AppxMetadata/CodeIntegrity.cat"}, "Unexpected bundle payload")
        with archive(bundle.read(leaf_name)) as leaf:
            for name in leaf.namelist():
                require(name in {"resources.pri", "AppxManifest.xml", "AppxBlockMap.xml", "[Content_Types].xml", "AppxSignature.p7x", "AppxMetadata/CodeIntegrity.cat"}
                        or (name.startswith("Images/") and name.endswith(".png")), "Unexpected executable or data in hosted package")
            manifest = xml(leaf.read("AppxManifest.xml"))
            identity(manifest.find(F + "Identity"), config, version)
            require(manifest.find(F + "Identity").get("ProcessorArchitecture") == "neutral", "Unexpected app architecture")
            require(manifest.find(F + "Properties/" + F + "DisplayName").text == config["name"], "Unexpected app name")
            apps = manifest.findall(F + "Applications/" + F + "Application")
            require(len(apps) == 1, "Unexpected applications")
            app = apps[0]
            arguments = (f'--app-id={config["edgeAppId"]} '
                         '--ip-edge-aumid=Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!MSEDGE '
                         f'--app-fallback-url={config["url"]} --display-mode=standalone --windows-store-app')
            require(app.attrib == {"Id": "App", U10 + "HostId": "PWA", U10 + "Parameters": arguments}, "Unexpected launcher or browser arguments")
            extensions = app.findall(F + "Extensions/" + U3 + "Extension")
            require(len(extensions) == 2 and all(e.get("Category") == "windows.appExtension" for e in extensions), "Unexpected app extensions")
            values = [e.find(U3 + "AppExtension") for e in extensions]
            require({e.get("Name") for e in values} == {"microsoft.store.edgePWA", "com.ms.webapp.internals.4"}, "Unexpected extension names")
            internal = next(e for e in values if e.get("Name") == "com.ms.webapp.internals.4")
            require(internal.get("Description") == f'parameters?{arguments};profile-directory?Default;start-url?{config["url"]}', "Unexpected launch origin")
            capabilities = manifest.find(F + "Capabilities")
            require(len(capabilities) == 1 and capabilities[0].get("Name") == "runFullTrust", "Unexpected capabilities")
            host = manifest.find(F + "Dependencies/" + U10 + "HostRuntimeDependency")
            require(host is not None and host.get("Name") == "Microsoft.MicrosoftEdge.Stable"
                    and host.get("Publisher") == "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US", "Unexpected host dependency")
    return {"identity": config["packageId"], "version": version, "architecture": "neutral", "origin": config["url"], "host": "Microsoft Edge Stable"}


def main():
    stage = Path(sys.argv[1])
    release = json.loads((stage / "release.json").read_text())
    config = json.loads(Path("infra/windows/package.json").read_text())
    require(all(release[k] == v for k, v in config.items()), "Release differs from reviewed configuration")
    version = release["version"]
    require(release["packageFile"] == f"Pipeline-{version}.msixbundle", "Unexpected package filename")
    if "--signed" in sys.argv:
        data = (stage / release["packageFile"]).read_bytes()
    else:
        raw = (stage / "pwabuilder.zip").read_bytes()
        require(hashlib.sha256(raw).hexdigest() == release["archiveSha256"], "Downloaded archive changed")
        with archive(raw) as zipped:
            data = zipped.read("Pipeline.msixbundle")
    proof = validate_bundle(data, config, version)
    digest = hashlib.sha256(data).hexdigest()
    if "--signed" not in sys.argv:
        (stage / release["packageFile"]).write_bytes(data)
        release["unsignedSha256"] = digest
        (stage / "release.json").write_text(json.dumps(release, indent=2) + "\n")
    proof["sha256"] = digest
    proof["signatureVerified"] = False  # Windows SignTool separately establishes publisher trust.
    (stage / "package-inspection.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps(proof))


if __name__ == "__main__":
    main()
