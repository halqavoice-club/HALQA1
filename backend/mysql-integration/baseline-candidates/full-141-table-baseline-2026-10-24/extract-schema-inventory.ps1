# Deprecated Unit B-5 extractor. Its regex truncated nested defaults and did not
# provide enum, relation, or action parity. Unit B-6 fails closed instead of
# regenerating incomplete evidence.
Write-Error "Deprecated: run node validate-offline.js from the repository root."
exit 1
