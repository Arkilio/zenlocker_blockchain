pragma solidity ^0.4.4;
import "Documents.sol";
contract RequestRegistry {
  Documents documentRegistry;

  struct Request {
    address requester;
    address sender;
    uint docID;
    bytes ipfsHash;
    bool granted;
    bool completed;
    uint requestTime;
    uint completedTime;
    string docName;
  }
  uint public requestID = 1;
  mapping (uint => Request) accessRegistry;
  mapping (address => uint[]) requests;
  event DocumentRequested(address indexed assignee, uint requestID, uint docID);
  event AccessGranted(address sender, uint requestID);
  event DocumentAttested(address issuer, uint requestID, uint docID);
  modifier onlyValidDocument(uint docID) {
    address assignee = documentRegistry.getAssignee(docID);
    if(assignee == address(0x0)) {
        throw;
    }
    _;
  }

  function sendDocument(uint docID, address _to, bytes ipfsHash, string name) onlyValidDocument(docID) {
      address assignee = documentRegistry.getAssignee(docID);
      if(assignee != msg.sender) {
        throw;
      }

      requestID = requestID + 1;
      Request r = accessRegistry[requestID];
      r.docID = docID;
      r.requester = _to;
      r.requestTime = now;
      r.sender = msg.sender;
      r.ipfsHash = ipfsHash;
      r.completed = true;
      r.docName = name;
      r.completedTime = now;
      accessRegistry[requestID] = r;
      requests[msg.sender].push(requestID);
      requests[_to].push(requestID);

  }

  function requestDocument (string docName, address sender) {
    Request r = accessRegistry[requestID];
    r.sender = sender;
    r.docName = docName;
    r.requester = msg.sender;
    r.requestTime = now;
    accessRegistry[requestID] = r;
    requests[msg.sender].push(requestID);
    requests[sender].push(requestID);
    requestID = requestID + 1;
    //DocumentRequested(msg.sender, requestID-1, docID-1);
  }

  function grantAccess(uint requestID, uint docID, bytes docHash) onlyValidDocument(docID) {
      Request r = accessRegistry[requestID];
      address assignee = documentRegistry.getAssignee(docID);
      if(assignee != msg.sender) {
          throw;
      }
      if(r.sender != msg.sender) {
          throw;
      }
      r.granted = true;
      r.completed = true;
      r.completedTime = now;
      r.ipfsHash = docHash;
      r.docID = docID;
      accessRegistry[requestID] = r;
      AccessGranted(msg.sender, requestID);
  }

  function RequestRegistry(address docRegistryAddress) {
      documentRegistry = Documents(docRegistryAddress);
  }


  function getRequests(address _for) constant returns(uint[]) {
      return requests[_for];
  }

  function getRequest(uint requestID) constant public returns(address sender ,address requester, uint docID ,bytes docIPFSHash, bool granted, bool completed, uint completedTime, uint _requestID, string docName) {
      Request req = accessRegistry[requestID];
      docID  = req.docID;
      docIPFSHash = req.ipfsHash;
      granted = req.granted;
      requester = req.requester;
      sender = req.sender;
      _requestID = requestID;
      completedTime = req.completedTime;
      completed = req.completed;
      docName = req.docName;
  }
}
