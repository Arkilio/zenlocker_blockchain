var moment = require('moment');
var bs58 = require('bs58');
var lightwallet = require('eth-lightwallet');
var utils = require('ethereumjs-util');
var Web3 = require('web3');
var web3 = new Web3();
var EthQuery = require('eth-query');
var accounts = require('./Accounts');
var async = require('async');
var mustache = require('mustache');
var _ = require('underscore');
var HookedWeb3Provider = require("hooked-web3-provider");
var uport = require('uport-persona');
var ipfs = window.IpfsApi('localhost', '5001')
var rpcURL = '127.0.0.1';
var base64converter = require('base64-arraybuffer');
var keyStore = lightwallet.keystore;
var encryption = lightwallet.encryption;
var registryAddress = require('./../build/contracts/UportRegistry.sol').deployed().address;
console.log(registryAddress);
var EmailRegistry = require('./../build/contracts/EmailRegistry.sol.js');
var emailRegistry = EmailRegistry.deployed();
var RequestRegistry = require('./../build/contracts/RequestRegistry.sol.js')
var requestRegistry = RequestRegistry.deployed();
var formTemplate = '<form id= "documentUploadForm"> <div class="row"> <div class="large-offset-1 large-12 columns"> <br/> <h3>Upload Document</h3> </div> </div><div class="row"> <div class="large-6 large-offset-1 columns"> <label>Document Name : <input id = "document_name" required type="text" placeholder="Document Name" /> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <label> Document : <input id = "doc" required type="file" value="Choose File"> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <input type="submit" value = "Upload Document" class="button medium"/> </div> </div> </form><div id="error" class="row hidden"> <div class="large-offset-1 large-10 columns"> <p style="font-weight:bold;font-size:19px;" id="errorMessage" class="error"></h3> </div> </div> <div id="success" class="row hidden"> <div class="large-offset-1 large-10 columns"> <br/> <p style="font-weight:bold;font-size:19px;" id="successMessage"></p> <a href="#" onclick="location.reload()" class="large button">Back</a> </div> </div>'
var sendFormTemplate = '<form id="sendDocumentForm"><input type="hidden" id="docID"/><input type="hidden" id="document_name"/><div class="row"><div class="large-12 columns"> <br/> <h3>Send Document</h3> </div> </div><div class="row"><div class="large-6 columns"><label>Email Address : <input id = "email_id" required type="text" placeholder="Email Address" /> </label></div></div><div class="row"><div class="large-12 columns"><p id="send_message"></p></div></div><div class="row"> <div class="large-6 columns"> <input type="submit" value = "Send Document" class="button medium"/></div></div></form><div class="row hidden"><div class = "large-offset-1 large-10 offset" id="success"></div></div><div class="row hidden"><div class = "large-offset-1 large-10 offset" id="errorMessage"></div></div>';
var docTemplate = '<thead><tr><th width="100">#</th><th width="200">Name</th><th width="200">Issuer</th><th width="140">Actions</th><th width="200">Timestamp</th></tr></thead><tbody>{{#documents}}<tr><td><a onclick="showDocument({{id}})"><u>{{id}}</u></a></td><td>{{name}}</td><td>{{issuer}}</td><td><a onclick="sendDocumentButtonHandler({{id}}, \'{{name}}\')"><u>Send</u></a></td><td>{{timestamp}}</td></tr>{{/documents}}</tbody>';
var recievedDocumentsTemplate = '<div class="row"><div class="large-5 columns"><h3 style="padding-top:12px;">Recieved Documents</h3></div></div><div class="row"><div class="large-12 columns"><table><thead><tr><th width="100">#</th><th width="170">Name</th><th width="170">From</th><th width="170">Issuer</th><th width="170">Timestamp</th></tr></thead><tbody>{{#requests}}<tr><td><a onclick="showRequest({{id}})"><u>{{id}}</u></a></td><td>{{doc.name}}</td><td>{{from}}</td><td>{{issuer}}</td><td>{{timestamp}}</td></tr>{{/requests}}</tbody></table></div></div>';
var myRequestTemplate = '<div class="row"><div class="large-6 columns"><h5 style="padding-top:12px;"> Requests For Documents</h5></div></div><div class="row"><div class="large-12 columns"><table><thead><tr><th width="100">#</th><th width="170">Requester Note</th><th width="170">From</th><th width="200">Timestamp</th><th width="150">Action</th></tr></thead><tbody>{{#requests}}<tr><td><a onclick="showRequest({{id}})"><u>{{id}}</u></a></td><td>{{name}}</td><td>{{from}}</td><td>{{timestamp}}</td><td><a onclick="selectDocument({{id}}, \'{{from}}\')"><u>Select Document</u></a></td></tr>{{/requests}}</tbody></table></div></div>';
var myDocumentsTemplate = '<div class="row"><div class="large-5 columns"><h3 style="padding-top:12px;">My Documents</h3></div><div class="large-1 large-offset-2 columns"><a style="margin-top:14px;" onclick="uploadButtonHandler()" class = "button" id="upload">Upload</a></div><div class="large-3 large-offset-1 columns"><a style="margin-top:14px;" onclick="requestDocumentHandler()" class = "button" id="upload">Request a document</a></div></div><div class="row"><div class="large-12 columns"><table id="documents"><thead><tr><th width="100">#</th><th width="200">Name</th><th width="190">Issuer</th><th width="150">Actions</th><th width="200">Timestamp</th></tr></thead></table></div></div>'
var issueDocumentTemplate = '<form id= "documentUploadForm"> <div class="row"> <div class="large-offset-1 large-12 columns"> <br/> <h3>Issue Document</h3> </div> </div><div class="row"><div class="large-6 large-offset-1 columns"><label>Email Address:<input type="text" id="email" required placeholder="Email Address"/></label></div></div> <div class="row"> <div class="large-6 large-offset-1 columns"> <label>Document Name : <input id = "document_name" required type="text" placeholder="Document Name" /> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <label> Document : <input id = "doc" required type="file" value="Choose File"> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <input type="submit" value = "Upload Document" class="button medium"/> </div> </div> </form><div id="error" class="row hidden"> <div class="large-offset-1 large-10 columns"> <p style="font-weight:bold;font-size:19px;" id="errorMessage" class="error"></h3> </div> </div> <div id="success" class="row hidden"> <div class="large-offset-1 large-10 columns"> <br/> <p style="font-weight:bold;font-size:19px;" id="successMessage"></p> <a href="#" onclick="location.reload()" class="large button">Back</a> </div> </div>'
var requestForm = '<form id= "requestForm"> <div class="row"> <div class="large-offset-1 large-12 columns"> <br/> <h3>Request A Document</h3> </div> </div><div class="row"> <div class="large-6 large-offset-1 columns"> <label>Document Name : <input id = "document_name" required type="text" placeholder="Document Name" /> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <label> Email Address : <input id = "email" required type="text" placeholder = "Enter email"> </label> </div> </div> <div class="row"> <div class="large-6 large-offset-1 columns"> <input type="submit" value = "Request a document" class="button medium"/> </div> </div> </form><div id="error" class="row hidden"> <div class="large-offset-1 large-10 columns"> <p style="font-weight:bold;font-size:19px;" id="errorMessage" class="error"></h3> </div> </div> <div id="success" class="row hidden"> <div class="large-offset-1 large-10 columns"> <br/> <p style="font-weight:bold;font-size:19px;" id="successMessage"></p> <a href="#" onclick="location.reload()" class="large button">Back</a> </div> </div>'
var showDocumentsForSelection = '<div class="row"><div class="large-12 columns"><b>Select a document for Request #{{req_id}} from {{requester}}</b></div></div><br/><div class="row"><div class="large-12 columns"><table><thead><tr><th width="100">#</th><th width="200">Name</th><th width="200">Issuer</th><th width="200">Timestamp</th><th width="100">Action</th></tr></thead><tbody>{{#documents}}<tr><td>{{id}}</td><td>{{name}}</td><td>{{issuer}}</td><td>{{timestamp}}</td><td><a onclick="selectDocumentAction({{id}}, {{req_id}}, \'{{name}}\')"><u>Select</u></a></td></tr>{{/documents}}</tbody></table></div></div>'
// var showDocumentsForSelection = '<div class="row"><div class="large-12 columns">Select a document for Request {{req_id}}</div></div><br/><div class="row"><div class="large-12 columns"><thead><tr><th width="100">#</th><th width="200">Name</th><th width="200">Issuer</th><th width="200">Timestamp</th><th width="100">Action</th></tr></thead><tbody>{{#documents}}<tr><td>{{id}}</td><td>{{name}}</td><td>{{issuer}}</td><td>{{timestamp}}</td><td><a onclick="selectDocumentAction({{id}})"><u>Select</u></a></td></tr>{{/documents}}</tbody></div></div>'
var Promise = require('bluebird');
var encryptionHDPath = "m/0'/0'/2'";
var DocumentRegistry = require('./../build/contracts/Documents.sol');
var documentRegistry = DocumentRegistry.deployed();
var streamSaver = require("streamSaver");
var test_accounts = require('./test_accounts');
var encryptionKey;
var cookie = require("js-cookie");


function base58ToHex(b58) {
    var hexBuf = new Buffer(bs58.decode(b58));
    return hexBuf.toString('hex');
};

function showDocument (docID) {
    getDocumentById(docID);
}

function showRequest(requestID) {
    var sender;
    var requester;
    var ipfsHash;
    var encryptionKey;
    requestRegistry.getRequest(requestID, {from : userDetails.address})
    .then(function(results){
        sender = results[0];
        requester = results[1];
        ipfsHash = results[3];
        persona = new uport.Persona(sender, ipfs, web3.currentProvider, registryAddress);
        return persona.load();
    }).then(function () {

        encryptionKey = persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
        var hashHex = hexToBase58(ipfsHash.slice(2));
        return ipfs.cat(hashHex, {buffer : true});
    }).then(function (body) {
        var encryptedObject = body.toString();
        var pubKey = userDetails.keyStoreInstance.getPubKeys(encryptionHDPath)[0];
        var userPublicKey_ = utils.stripHexPrefix(pubKey);
        encryptedObject = JSON.parse(encryptedObject);
        encryptionKey = utils.stripHexPrefix(encryptionKey);
        var cleartext = encryption.asymDecryptString(userDetails.keyStoreInstance, userDetails.pwDerivedKey, encryptedObject, encryptionKey, userPublicKey_, encryptionHDPath);
        cleartext = JSON.parse(cleartext);
        download(cleartext.filename, cleartext.data);
    });
}

window.showRequest = showRequest;

function selectDocumentAction(docID, reqID, docName) {
    if(!confirm("Are you sure to select Document " + docName.toUpperCase())) {
        return;
    }
    var receipentAddress;
    var persona;
    var encryption_key;
    debugger;
    async.parallel({
        doc : function(_cb) {
            documentRegistry.getDocumentById(docID, {from :userDetails.address})
            .then(function(docArray) {
                var _map = {
                    id : docArray[3].toString(),
                    timestamp : moment(docArray[4]).format('llll'),
                    name : docArray[5],
                    issuer : docArray[0],
                    assignee : docArray[1],
                    assigneeHash : docArray[2]
                }
                _cb(null, _map);
            });
        },
        toAddress : function(_cb) {
            requestRegistry.getRequest(reqID, {from : userDetails.address}).
            then(function(request) {
                var persona = new uport.Persona(request[1], ipfs, web3.currentProvider, registryAddress);
                persona.load().then(function() {
                    var e_ = persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
                    _cb(null, {encryption_key : e_})
                })
            })

        }

    }, function(err, results) {
        receipent = results.toAddress;
        var issuerPubKey;
        var receipentEk = utils.stripHexPrefix(results.toAddress.encryption_key);
        persona = new uport.Persona(results.doc.issuer, ipfs, web3.currentProvider, registryAddress);
        persona.load()
        .then(function() {
            return persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
        })
        .then(function(ek) {
            issuerPubKey = utils.stripHexPrefix(ek);
            var hashHex = hexToBase58(results.doc.assigneeHash.slice(2));
            return ipfs.cat(hashHex, {buffer : true});
        })
        .then(function(encryptedBuffer) {
            var encryptedBuffer = encryptedBuffer.toString();
            var encryptedObject = JSON.parse(encryptedBuffer);
            var pubKey = userDetails.keyStoreInstance.getPubKeys(encryptionHDPath)[0];
            var userPublicKey_ = utils.stripHexPrefix(pubKey);
            var cleartext = encryption.asymDecryptString(userDetails.keyStoreInstance, userDetails.pwDerivedKey, encryptedObject, issuerPubKey, userPublicKey_, encryptionHDPath);
            cleartext = JSON.parse(cleartext);
            var msg = Buffer.from(cleartext.data,'base64');
            return encryptImagePromise(userDetails.keyStoreInstance, userDetails.pwDerivedKey, receipentEk, encryptionHDPath, msg, userDetails.address, cleartext.filename);
        }).then(function(encryptedObject) {
            encryptedObject = JSON.stringify(encryptedObject);
            var encryptedBuffer = utils.toBuffer(encryptedObject);
            return ipfs.add(encryptedBuffer);

        }).then(function(ipfsResult) {
            var recieverIPFSHash = '0x' + base58ToHex(ipfsResult[0].hash);
            // grantAccess(uint requestID, uint docID, bytes docHash)
            return requestRegistry.grantAccess(reqID, docID, recieverIPFSHash, {from : userDetails.address})
            //return requestRegistry.sendDocument(docID, receipent.address, recieverIPFSHash, documentName, {from : userDetails.address});
        }).then(function(tx) {
            debugger;
            location.reload();
            // $("#sendDocumentForm").hide();
            // $("#success").html("<br/><p style=\"font-weight:bold;\">Your document <b> " + documentName.toUpperCase() + "</b> has been sent to " + email + "<br/>Transaction ID : " + tx + "</p>" + '<a onclick="location.reload()" class="large button">Back</a>');
        });
    });
}
window.selectDocumentAction = selectDocumentAction;
function issueDocumentMenuHandler(elem) {
    makeMenuActive(elem);
    $("#workflow_container").empty();
    $("#workflow_container").html(issueDocumentTemplate);
    document.getElementById("documentUploadForm").addEventListener("submit", uploadDocument);

}

window.issueDocumentMenuHandler = issueDocumentMenuHandler;

function readFile(file, callback) {
    var reader = new FileReader();
    reader.onload = function() {
        var array = new Buffer(reader.result);
        callback(null, array);
    }
    reader.readAsArrayBuffer(file);
}
var readFilePromise = Promise.promisify(readFile);


function requestDocumentHandler(e) {
    $("#workflow_container").empty();
    $("#workflow_container").html(requestForm);
    var form = document.getElementById("requestForm");
    form.addEventListener("submit", requestDocument);

}

function requestDocument(e) {
    e.preventDefault();
    var document_name = document.getElementById("document_name").value;
    var email = document.getElementById("email").value;
    var emailHash = utils.bufferToHex(utils.sha3(email));
    emailRegistry.getAddress(emailHash, {from : userDetails.address})
    .then(function(sender) {
        requestRegistry.requestDocument(document_name, sender, { from : userDetails.address}).then(function() {
            $("#requestForm").remove();
            var message = 'Request for ' + document_name + ' has been sent to ' + email;
            $("#successMessage").html(message);
            $("#success").removeClass("hidden");

        });

    })

}

function selectDocument(req_id, requester) {
    $("workflow_container").empty();
    documentRegistry.getDocumentsIssuedTo(userDetails.address, {from: userDetails.address}).then(function(docs) {
        docs = _.map(docs, function(d) {
            return parseInt(d.toString());
        });

        async.map(docs, function(doc, callback) {
            documentRegistry.getDocumentById(doc, {from : userDetails.address}).then(function(docArray) {
                var _map = {
                    id : docArray[3].toString(),
                    timestamp : moment(docArray[4]).format('llll'),
                    name : docArray[5],
                    issuer : docArray[0]
                }
                if (_map.issuer == userDetails.address) {
                    _map.issuer = "Uploaded by me";
                    callback(null, _map);
                }
                else {
                    var issuerPersona = new uport.Persona(_map.issuer, ipfs, web3.currentProvider, registryAddress);
                    issuerPersona.load().then(function() {
                        _map.issuer = issuerPersona.getClaims('display_name')[0].decodedToken.payload.claim.display_name;
                        _map.issuer = _map.issuer[0].toUpperCase() + _map.issuer.substring(1);
                        callback(null, _map);
                    });
                }
            });
        },function(err, docs) {
            docs = _.sortBy(docs, 'timestamp').reverse();
            var renderedTable = mustache.render(showDocumentsForSelection, {
                documents : docs,
                req_id: req_id,
                requester : requester
            });
            debugger;
            $('#workflow_container').html(renderedTable);
        });

    })
}

window.selectDocument = selectDocument;
window.requestDocumentHandler = requestDocumentHandler;

function requestedDocumentsHandler(e) {
    $("#workflow_container").empty();
    requestRegistry.getRequests(userDetails.address, {from : userDetails.address})
    .then(function(requests) {
        return _.map(requests, function(r) {
            return parseInt(r.toString());
        });
    }).then(function(requests) {
        async.map(requests, function(request, callback) {
            requestRegistry.getRequest(request, {from : userDetails.address}).then(function(r) {
                result = {
                    sender : r[0],
                    from : r[1],
                    doc : parseInt(r[2].toString()),
                    ipfsHash : r[3],
                    granted : r[4],
                    completed : r[5],
                    timestamp : moment(parseInt(r[6].toString())).format('llll'),
                    id : parseInt(r[7].toString()),
                    name : r[8]
                }
                callback(null, result)
            });
        }, function(err, requests) {
            requests = _.filter(requests, function(r) {
                return r.sender == userDetails.address && !r.completed;
            });
            async.map(requests, function(req, callback) {

                var _i = req.from;
                var issuerPersona = new uport.Persona(_i, ipfs, web3.currentProvider, registryAddress);
                issuerPersona.load().then(function() {
                    var dp = issuerPersona.getClaims("display_name")[0].decodedToken.payload.claim.display_name;
                    req.from = dp;
                    callback(null, req);
                });
            }, function(err, requests) {
                requests = _.sortBy(requests, 'timestamp').reverse();
                $("#workflow_container").html(mustache.render(myRequestTemplate, {requests : requests}));
            });
        });
    })

}

window.requestedDocumentsHandler = requestedDocumentsHandler;

window.showDocument = showDocument;

function hexToBase58(hexStr) {
    var buf = new Buffer(hexStr, 'hex');
    return bs58.encode(buf);
};

function encryptImage(keystore, pwDerivedKey, encryptionKey, path, data, owner, filename, callback) {
    var msg = new Buffer(data).toString('base64');
    var meta = {
        owner : owner,
        filename : filename,
        data : msg
    }

    var pubKey = keystore.getPubKeys(path)[0];
    var userPublicKey_ = utils.stripHexPrefix(pubKey);
    encryptionKey = utils.stripHexPrefix(encryptionKey);
    var encryptedObject = encryption.asymEncryptString(keystore, pwDerivedKey, JSON.stringify(meta), userPublicKey_, encryptionKey, path);
    callback(null, encryptedObject);
}

var encryptImagePromise = Promise.promisify(encryptImage);

function createWeb3Provider(rpcURL, keyStoreInstance) {
    var query;
    var provider = new HookedWeb3Provider({
        host: undefined,
        transaction_signer: {
            hasAddress: function(address, callback) {
                callback(null, true);
            },
            signTransaction: function(txParams, callback) {
                async.parallel({
                    gas: function(callback) {
                        query.estimateGas(txParams, callback);
                    },
                    gasPrice: function(callback) {
                        query.gasPrice(callback);
                    }
                }, function(err, result) {
                    txParams.gas = result.gas;
                    txParams.gasPrice = result.gasPrice;
                    keyStoreInstance.signTransaction(txParams, callback);
                });
            }
        }
    });
    query = new EthQuery(provider);
    return provider;
}

function appInit(args, onSuccess, onError) {
    accounts.createNewAccount(args, function(err) {
        if (err) {
            return onError(err);
        }
        var args = _.toArray(arguments);
        args = args.slice(1);
        args.push(user_account.email);
        onSuccess.apply(this, args);
    });
}

function errorlog(e) {
    console.log('error', e);
}


function logout() {
    cookie.remove("zenlocker");
    cookie.remove("emailHash");
    location.href = "/login.html";
}

window.logout = logout;

var userDetails = {};

function onReady(address, encryption_key, pwDerivedKey, keyStoreInstance, emailHash) {
    userDetails = {
        address: address,
        encryption_key: encryption_key,
        pwDerivedKey: pwDerivedKey,
        keyStoreInstance: keyStoreInstance,
        emailHash : emailHash
    };
    var provider = createWeb3Provider(rpcURL, keyStoreInstance);
    web3.setProvider(provider);
    DocumentRegistry.setProvider(provider);
    EmailRegistry.setProvider(provider);
    RequestRegistry.setProvider(provider);
    console.log('App ready');
    console.log(address);
    persona = new uport.Persona(address, ipfs, web3.currentProvider, registryAddress);
    persona.load().then(function() {
        name = persona.getClaims('display_name')[0].decodedToken.payload.claim.display_name;
        name = name[0].toUpperCase() + '' + name.substring(1);
        document.getElementById("username").innerHTML = name;
        myDocumentsMenuHandler();
        $("#dashboard").show();
    });
}


function makeMenuActive(elem) {
    if(!elem) return;
    var lis = $(elem).parent().parent().children()
    for(var i=0;i<lis.length;i++) {
        $(lis[i]).removeClass("active");
    }
    $(elem).parent().addClass("active");
}

function myDocumentsMenuHandler(elem) {
    if(elem) {
        makeMenuActive(elem);
    }
    $("#workflow_container").empty();
    $("#workflow_container").html(myDocumentsTemplate);
    getDocumentsForUser(userDetails.address);
}

window.myDocumentsMenuHandler = myDocumentsMenuHandler;


function getDocumentsForUser(address) {
    documentRegistry.getDocumentsIssuedTo(address, {
        from : address
    }).then(function(docs) {
        debugger;
        return _.map(docs, function(doc) {
            return parseInt(doc.toString());
        });
    }).then(function(docs) {
        async.map(docs, function(doc, callback) {
            documentRegistry.getDocumentById(doc, {from : userDetails.address}).then(function(docArray) {
                var _map = {
                    id : docArray[3].toString(),
                    timestamp : moment(docArray[4]).format('llll'),
                    name : docArray[5],
                    issuer : docArray[0]
                }
                if (_map.issuer == userDetails.address) {
                    _map.issuer = "Uploaded by me";
                    callback(null, _map);
                }
                else {
                    var issuerPersona = new uport.Persona(_map.issuer, ipfs, web3.currentProvider, registryAddress);
                    issuerPersona.load().then(function() {
                        _map.issuer = issuerPersona.getClaims('display_name')[0].decodedToken.payload.claim.display_name;
                        _map.issuer = _map.issuer[0].toUpperCase() + _map.issuer.substring(1);
                        callback(null, _map);
                    });
                }
            });
        },function(err, docs) {
            docs = _.sortBy(docs, 'timestamp').reverse();
            var renderedTable = mustache.render(docTemplate, {
                documents : docs
            });
            $('#documents').html(renderedTable);
        });
    });
}



function getDocumentById(docId) {
    var issuerPubKey;
    var issuer;
    var doc;
    var persona;
    var docName;
    documentRegistry.getDocumentById(docId, {
        from : userDetails.address
    }).
    then(function(_doc) {
        doc = _doc;
        issuer  =_doc[0];
        docName = _doc[5];
        persona = new uport.Persona(issuer, ipfs, web3.currentProvider, registryAddress);
        return persona.load();
    }).then(function() {
        return persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
    }).then(function(_issuerPubKey) {
        issuerPubKey = _issuerPubKey;
        var hashHex = hexToBase58(doc[2].slice(2));
        return ipfs.cat(hashHex, {buffer : true});
    }).then(function(body) {
        var encryptedObject = body.toString();
        var pubKey = userDetails.keyStoreInstance.getPubKeys(encryptionHDPath)[0];
        var userPublicKey_ = utils.stripHexPrefix(pubKey);
        encryptedObject = JSON.parse(encryptedObject);
        var cleartext = encryption.asymDecryptString(userDetails.keyStoreInstance, userDetails.pwDerivedKey, encryptedObject, utils.stripHexPrefix(issuerPubKey), userPublicKey_, encryptionHDPath);
        cleartext = JSON.parse(cleartext);
        download(cleartext.filename, cleartext.data)
    });
}



function download(filename, data) {
    var fileStream = streamSaver.createWriteStream(filename);
    var writer = fileStream.getWriter()
    var x = new Uint8Array(base64converter.decode(data));
    writer.write(x);
    writer.close();
}


function uploadDocument(e) {
    e.preventDefault();
    $("#error").hide();
    var uploadFile = document.getElementById("doc").files[0];
    var fullPath = document.getElementById('doc').value;
    var startIndex = (fullPath.indexOf('\\') >= 0 ? fullPath.lastIndexOf('\\') : fullPath.lastIndexOf('/'));
    var filename = fullPath.substring(startIndex);
    var fileExtension = 'xp'
    if (filename.indexOf('\\') === 0 || filename.indexOf('/') === 0) {
        filename = filename.substring(1);
    }

    var document_name = document.getElementById("document_name").value;
    var persona;
    var theirPubKey;
    var userAddress;
    var docHash;
    var assigneeHash;
    var imgData;
    var email = document.getElementById("email") && document.getElementById("email").value
    var emailHash;
    if (!email) {
        emailHash = userDetails.emailHash;

    }
    else {
        emailHash = utils.bufferToHex(utils.sha3(email));
    }
    e.preventDefault();
    emailRegistry.getAddress(emailHash, {from : userDetails.address}).then(function(address) {
        userAddress = address;
        persona = new uport.Persona(address, ipfs, web3.currentProvider, registryAddress);
        return persona.load()
    }).then(function(_persona) {
        return persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
    }).then(function(encryption_key) {
        theirPubKey = encryption_key;
        return readFilePromise(uploadFile);
    }).then(function(data) {
        imgData = data;
        docHash = utils.bufferToHex(utils.sha3(data));
        var keystore = userDetails.keyStoreInstance;
        return encryptImagePromise(keystore, userDetails.pwDerivedKey, theirPubKey, encryptionHDPath, data, emailHash, filename);
    }).then(function(encryptedObject) {
        encryptedObject = JSON.stringify(encryptedObject);
        var encryptedBuffer = utils.toBuffer(encryptedObject);
        return ipfs.add(encryptedBuffer);
    }).then(function(ipfsResult) {
        var assigneeHashHex = '0x' + base58ToHex(ipfsResult[0].hash);
        return documentRegistry.addDocument(docHash, assigneeHashHex, userAddress, document_name, fileExtension, {from : userDetails.address});
    }).then(function(tx) {
        console.log(tx);
        $("#documentUploadForm").hide();
        $("#success").show();
        var successMessage = "The document has been successfully uploaded <br/> Transaction ID " + tx + "<br/> Document Hash " + docHash;
        $("#successMessage").html(successMessage)
    }).catch(function(err) {
        var msg = 'A Unknown Error has occurred. Please try again'
        if (err && err.message && err.message.indexOf("multihash") >= 0) {
            msg = "The ID is invalid";
        }
        else if(err && err.message && err.message.indexOf("invalid") >=0) {
            msg = 'This document already exists';
        }
        $("#error").show();
        $("#errorMessage").html(msg);
    });
}

function sendDocumentButtonHandler(id, name) {

    // replace the Dom
    // email registry
    // fill requestAccess
    $("#workflow_container").empty();
    $("#workflow_container").html(sendFormTemplate);
    var doc_message = 'You have selected Document <b>#' + id + "-" + name.toUpperCase() + "</b> to send";
    $("#send_message").html(doc_message);
    $("#docID").val(id);
    $("#document_name").val(name);
    var form = document.getElementById("sendDocumentForm");
    form.addEventListener("submit", sendDocument);
}

window.sendDocumentButtonHandler = sendDocumentButtonHandler;

function sendDocument(e) {
    e.preventDefault();
    console.log('called');
    var email = document.getElementById('email_id').value;
    var emailHash = utils.bufferToHex(utils.sha3(email));
    var docID = document.getElementById("docID").value;
    var documentName = document.getElementById("document_name").value;
    var receipentAddress;
    var persona;
    var encryption_key;

    async.parallel({
        doc : function(_cb) {
            documentRegistry.getDocumentById(docID, {from :userDetails.address})
            .then(function(docArray) {
                var _map = {
                    id : docArray[3].toString(),
                    timestamp : moment(docArray[4]).format('llll'),
                    name : docArray[5],
                    issuer : docArray[0],
                    assignee : docArray[1],
                    assigneeHash : docArray[2]
                }
                _cb(null, _map);
            });
        },
        toAddress : function(_cb) {

            emailRegistry.getAddress(emailHash, {from : userDetails.address}).then(function(_receipentAddress) {
                var rPersona = new uport.Persona(_receipentAddress, ipfs, web3.currentProvider, registryAddress);
                rPersona.load().then(function() {
                    var encryption_key = rPersona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
                    _cb(null, {
                        encryption_key : encryption_key,
                        address : _receipentAddress
                    });
                });
            });
        }

    }, function(err, results) {
        receipent = results.toAddress;
        var issuerPubKey;
        var receipentEk = utils.stripHexPrefix(results.toAddress.encryption_key);
        persona = new uport.Persona(results.doc.issuer, ipfs, web3.currentProvider, registryAddress);
        persona.load()
        .then(function() {
            return persona.getClaims('encryption_key')[0].decodedToken.payload.claim.encryption_key;
        })
        .then(function(ek) {
            issuerPubKey = utils.stripHexPrefix(ek);
            var hashHex = hexToBase58(results.doc.assigneeHash.slice(2));
            return ipfs.cat(hashHex, {buffer : true});
        })
        .then(function(encryptedBuffer) {
            var encryptedBuffer = encryptedBuffer.toString();
            var encryptedObject = JSON.parse(encryptedBuffer);
            var pubKey = userDetails.keyStoreInstance.getPubKeys(encryptionHDPath)[0];
            var userPublicKey_ = utils.stripHexPrefix(pubKey);
            var cleartext = encryption.asymDecryptString(userDetails.keyStoreInstance, userDetails.pwDerivedKey, encryptedObject, issuerPubKey, userPublicKey_, encryptionHDPath);
            cleartext = JSON.parse(cleartext);
            var msg = Buffer.from(cleartext.data,'base64');
            return encryptImagePromise(userDetails.keyStoreInstance, userDetails.pwDerivedKey, receipentEk, encryptionHDPath, msg, userDetails.address, cleartext.filename);
        }).then(function(encryptedObject) {
            encryptedObject = JSON.stringify(encryptedObject);
            var encryptedBuffer = utils.toBuffer(encryptedObject);
            return ipfs.add(encryptedBuffer);

        }).then(function(ipfsResult) {
            var recieverIPFSHash = '0x' + base58ToHex(ipfsResult[0].hash);
            return requestRegistry.sendDocument(docID, receipent.address, recieverIPFSHash, documentName, {from : userDetails.address});
        }).then(function(tx) {
            $("#sendDocumentForm").hide();
            $("#success").html("<br/><p style=\"font-weight:bold;\">Your document <b> " + documentName.toUpperCase() + "</b> has been sent to " + email + "<br/>Transaction ID : " + tx + "</p>" + '<a onclick="location.reload()" class="large button">Back</a>');
        });
    });
}

function uploadButtonHandler(e) {
    $("#workflow_container").empty();
    $("#workflow_container").html(formTemplate);
    var form = document.getElementById("documentUploadForm");
    form.addEventListener("submit", uploadDocument);
}

window.uploadButtonHandler = uploadButtonHandler;

function recievedDocumentsMenuHandler(elem) {
    makeMenuActive(elem);
    $("#workflow_container").empty();
    requestRegistry.getRequests(userDetails.address, {from : userDetails.address})
    .then(function(requests) {
        return _.map(requests, function(r) {
            return parseInt(r.toString());
        });
    }).then(function(requests) {
        async.map(requests, function(request, callback) {
            requestRegistry.getRequest(request, {from : userDetails.address}).then(function(r) {
                result = {
                    from : r[0],
                    doc : parseInt(r[2].toString()),
                    ipfsHash : r[3],
                    granted : r[4],
                    completed : r[5],
                    timestamp : moment(parseInt(r[6].toString())).format('llll'),
                    id : parseInt(r[7].toString())
                }
                callback(null, result)
            });
        }, function(err, requests) {
            debugger;
            requests = _.filter(requests, function(r) {
                return r.completed;
            });
            async.map(requests, function(req, callback) {
                documentRegistry.getDocumentById(req.doc, {from : userDetails.address}).then(function(docArray) {
                    var _map = {
                        id : docArray[3].toString(),
                        timestamp : moment(docArray[4]).format('llll'),
                        name : docArray[5],
                        issuer : docArray[0],
                        assignee : docArray[1]
                    }
                    req.doc = _map;
                    async.parallel({
                        issuer_display_name : function(_c) {
                            var _i = _map.issuer;
                            var issuerPersona = new uport.Persona(_i, ipfs, web3.currentProvider, registryAddress);
                            issuerPersona.load().then(function() {
                                var dp = issuerPersona.getClaims("display_name")[0].decodedToken.payload.claim.display_name;
                                _c(null, dp);

                            })
                        },
                        from_display_name : function(_c) {
                            var _i = req.from;
                            var issuerPersona = new uport.Persona(_i, ipfs, web3.currentProvider, registryAddress);
                            issuerPersona.load().then(function() {
                                var dp = issuerPersona.getClaims("display_name")[0].decodedToken.payload.claim.display_name;
                                _c(null, dp);
                            });
                        }
                    }, function(err, dp) {
                        req.issuer = dp.issuer_display_name;
                        req.from = dp.from_display_name;
                        callback(null, req);
                    })
                });
            }, function(err, requests) {
                requests = _.filter(requests, function(r) {
                    return (r.doc.assignee != userDetails.address) && r.completed;
                });
                requests = _.sortBy(requests, 'timestamp').reverse();
                $("#workflow_container").html(mustache.render(recievedDocumentsTemplate, {requests : requests}));
            });
        });
    })

}
window.recievedDocumentsMenuHandler = recievedDocumentsMenuHandler;
document.addEventListener("DOMContentLoaded", function() {
    var k = cookie.get("zenlocker");
    if (!k) {
        location.href = "/login.html";
        return;
    }
    var keystore = keyStore.deserialize(k);
    document.getElementById("login").addEventListener("submit", function(e) {
        e.preventDefault();
        var password = document.getElementById("password").value;
        keystore.keyFromPassword(password, function(err, pwDerivedKey) {
            try {
                var seed = keystore.getSeed(pwDerivedKey);
                var address = accounts.getAddress(keystore, pwDerivedKey);
                var encryption_key = accounts.getEncryptionKey(keystore, pwDerivedKey);
                $("#unlock").remove();
                keystore.passwordProvider = function(callback) {
                    callback(null, password);
                }
                onReady(address, encryption_key, pwDerivedKey, keystore, cookie.get("emailHash"));
            } catch (e) {
                $("#error").html("Invalid Password");
            }
        });
    });
});
